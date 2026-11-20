const express = require('express');
const crypto = require('crypto');
const prisma = require('../prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendVideoCallEmail } = require('../services/email');
const { appBaseUrl } = require('../services/urls');

const router = express.Router();

const CALL_STATUSES = ['SCHEDULED', 'ACTIVE', 'ENDED'];

// If a call has no endTime, assume it lasts 1 hour from its start time.
const DEFAULT_CALL_DURATION_MIN = 60;

/**
 * Compute the real end timestamp of a call event:
 * startDate (date) + endTime ("HH:mm"), or startDate + startTime + 1h when
 * endTime is missing.
 */
function eventEndTime(event) {
  const start = new Date(event.startDate);
  const time = event.endTime || event.startTime;
  if (time) {
    const [h, m] = time.split(':').map(Number);
    const end = new Date(start);
    end.setHours(h, m || 0, 0, 0);
    return end;
  }
  return new Date(start.getTime() + DEFAULT_CALL_DURATION_MIN * 60 * 1000);
}

/**
 * Auto-end stale ACTIVE calls: a call whose scheduled end time has passed
 * is marked ENDED so it no longer shows as "Live".
 */
async function autoEndStaleCalls() {
  const active = await prisma.videoCallSession.findMany({
    where: { status: 'ACTIVE' },
    include: { event: true },
  });
  const now = new Date();
  const stale = active.filter((s) => eventEndTime(s.event) < now);
  for (const s of stale) {
    await prisma.videoCallSession.update({
      where: { id: s.id },
      data: { status: 'ENDED' },
    });
  }
  return stale.length;
}

function roomUrl(jitsiRoomId, req) {
  return `${appBaseUrl(req)}/video-calls/room/${jitsiRoomId}`;
}

function serializeSession(session, req) {
  return {
    id: session.id,
    eventId: session.eventId,
    jitsiRoomId: session.jitsiRoomId,
    hostId: session.hostId,
    status: session.status,
    roomUrl: roomUrl(session.jitsiRoomId, req),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * Resolve the set of user ids allowed to join a call:
 * the host (teacher/admin) plus every student linked directly or via groups.
 */
async function resolveAllowedUserIds(event) {
  const ids = new Set([event.createdById]);
  for (const link of event.students || []) ids.add(link.studentId);
  const groupIds = (event.groups || []).map((g) => g.groupId);
  if (groupIds.length) {
    const members = await prisma.groupMember.findMany({
      where: { groupId: { in: groupIds } },
      select: { studentId: true },
    });
    for (const m of members) ids.add(m.studentId);
  }
  return [...ids];
}

/**
 * Get or lazily create the VideoCallSession for a CALL/VIDEO event.
 * The room id is stable per event, so the join link never changes.
 */
async function getOrCreateSession(event) {
  if (event.videoCall) return event.videoCall;
  const jitsiRoomId = `re-${event.id}-${crypto.randomBytes(4).toString('hex')}`;
  return prisma.videoCallSession.create({
    data: {
      eventId: event.id,
      jitsiRoomId,
      hostId: event.createdById,
      status: 'SCHEDULED',
    },
  });
}

/**
 * GET /api/video-calls
 * Teacher/Admin: list calls (admin sees all, teacher sees own) with the
 * linked event title/date and participant counts.
 */
router.get('/', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    // Auto-end calls whose scheduled time has passed.
    await autoEndStaleCalls();

    const where = req.user.role === 'ADMIN' ? {} : { hostId: req.user.id };
    const sessions = await prisma.videoCallSession.findMany({
      where,
      include: {
        event: {
          include: {
            students: true,
            groups: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      calls: sessions.map((s) => ({
        ...serializeSession(s, req),
        event: {
          id: s.event.id,
          title: s.event.title,
          type: s.event.type,
          mode: s.event.mode,
          startDate: s.event.startDate,
          startTime: s.event.startTime,
          endTime: s.event.endTime,
          isRecurring: s.event.isRecurring,
          studentCount: s.event.students.length,
          groupCount: s.event.groups.length,
        },
      })),
    });
  } catch (err) {
    console.error('Video calls list error:', err);
    res.status(500).json({ error: 'Failed to fetch video calls' });
  }
});

/**
 * GET /api/video-calls/room/:jitsiRoomId
 * Authenticated. Resolves a room link to the call details and whether the
 * current user is allowed to join. Students who are not invited get 403.
 */
router.get('/room/:jitsiRoomId', requireAuth, async (req, res) => {
  try {
    // Auto-end calls whose scheduled time has passed.
    await autoEndStaleCalls();

    const session = await prisma.videoCallSession.findUnique({
      where: { jitsiRoomId: req.params.jitsiRoomId },
      include: {
        event: {
          include: {
            students: { include: { student: true } },
            groups: { include: { group: true } },
          },
        },
      },
    });
    if (!session) {
      return res.status(404).json({ error: 'Video call not found' });
    }

    const allowed = await resolveAllowedUserIds(session.event);
    if (!allowed.includes(req.user.id)) {
      return res.status(403).json({ error: 'Δεν έχετε δικαίωμα πρόσβασης σε αυτή την κλήση' });
    }

    res.json({
      call: {
        ...serializeSession(session, req),
        event: {
          id: session.event.id,
          title: session.event.title,
          description: session.event.description || null,
          startDate: session.event.startDate,
          startTime: session.event.startTime,
          endTime: session.event.endTime,
          isRecurring: session.event.isRecurring,
          host: {
            id: session.event.createdById,
            firstName: session.event.createdBy?.firstName || null,
            lastName: session.event.createdBy?.lastName || null,
          },
        },
        isHost: session.event.createdById === req.user.id,
      },
    });
  } catch (err) {
    console.error('Video call room resolve error:', err);
    res.status(500).json({ error: 'Failed to resolve video call' });
  }
});

/**
 * POST /api/video-calls/room/:jitsiRoomId/join
 * Authenticated. Marks the call ACTIVE when the host joins (idempotent).
 */
router.post('/room/:jitsiRoomId/join', requireAuth, async (req, res) => {
  try {
    const session = await prisma.videoCallSession.findUnique({
      where: { jitsiRoomId: req.params.jitsiRoomId },
      include: {
        event: {
          include: {
            students: true,
            groups: true,
          },
        },
      },
    });
    if (!session) {
      return res.status(404).json({ error: 'Video call not found' });
    }
    const allowed = await resolveAllowedUserIds(session.event);
    if (!allowed.includes(req.user.id)) {
      return res.status(403).json({ error: 'Δεν έχετε δικαίωμα πρόσβασης σε αυτή την κλήση' });
    }

    if (session.status === 'SCHEDULED' && session.event.createdById === req.user.id) {
      await prisma.videoCallSession.update({
        where: { id: session.id },
        data: { status: 'ACTIVE' },
      });
    }

    res.json({ ok: true, status: session.status === 'SCHEDULED' && session.event.createdById === req.user.id ? 'ACTIVE' : session.status });
  } catch (err) {
    console.error('Video call join error:', err);
    res.status(500).json({ error: 'Failed to join video call' });
  }
});

/**
 * POST /api/video-calls/room/:jitsiRoomId/end
 * Host only. Marks the call ENDED.
 */
router.post('/room/:jitsiRoomId/end', requireAuth, async (req, res) => {
  try {
    const session = await prisma.videoCallSession.findUnique({
      where: { jitsiRoomId: req.params.jitsiRoomId },
    });
    if (!session) {
      return res.status(404).json({ error: 'Video call not found' });
    }
    if (session.hostId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only the host can end this call' });
    }
    await prisma.videoCallSession.update({
      where: { id: session.id },
      data: { status: 'ENDED' },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Video call end error:', err);
    res.status(500).json({ error: 'Failed to end video call' });
  }
});

/**
 * POST /api/video-calls/:sessionId/resend
 * Teacher/Admin (host or admin). Re-sends the invitation email to every
 * invited student that has an email address.
 * Body: { sendEmail?: boolean } — when false, only returns the recipients
 * without sending (dry run).
 */
router.post('/:sessionId/resend', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const session = await prisma.videoCallSession.findUnique({
      where: { id: req.params.sessionId },
      include: {
        event: {
          include: {
            students: { include: { student: true } },
            groups: { include: { group: { include: { members: { include: { student: true } } } } } },
          },
        },
      },
    });
    if (!session) {
      return res.status(404).json({ error: 'Video call not found' });
    }
    if (req.user.role !== 'ADMIN' && session.hostId !== req.user.id) {
      return res.status(403).json({ error: 'You can only resend emails for your own calls' });
    }

    const sendEmail = req.body?.sendEmail !== false;
    const recipients = new Map(); // email -> { name, userId }
    const addStudent = (student) => {
      if (student && student.email) {
        recipients.set(student.email, {
          userId: student.id,
          name: [student.firstName, student.lastName].filter(Boolean).join(' ') || student.username,
        });
      }
    };
    for (const link of session.event.students || []) addStudent(link.student);
    for (const link of session.event.groups || []) {
      for (const member of link.group?.members || []) addStudent(member.student);
    }

    const results = [];
    for (const [email, recipient] of recipients) {
      let emailSent = false;
      let emailError = null;
      if (sendEmail) {
        const outcome = await sendVideoCallEmail(email, {
          toEmail: email,
          title: session.event.title,
          description: session.event.description || undefined,
          startDate: session.event.startDate,
          startTime: session.event.startTime,
          endTime: session.event.endTime,
          roomUrl: roomUrl(session.jitsiRoomId, req),
          hostName: req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : req.user.username,
        });
        emailSent = outcome.sent;
        emailError = outcome.sent ? null : outcome.reason;
      }
      results.push({ email, name: recipient.name, userId: recipient.userId, emailSent, emailError });
    }

    res.json({ recipients: results, sent: sendEmail });
  } catch (err) {
    console.error('Video call resend error:', err);
    res.status(500).json({ error: 'Failed to resend video call emails' });
  }
});

module.exports = router;
