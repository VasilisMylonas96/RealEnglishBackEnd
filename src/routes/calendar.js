const express = require('express');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendVideoCallEmail, sendCalendarEventEmail } = require('../services/email');
const { appBaseUrl, toRelativePath } = require('../services/urls');

const router = express.Router();
const prisma = new PrismaClient();

const EVENT_TYPES = ['LESSON', 'CALL'];
const EVENT_MODES = ['VIDEO', 'IN_PERSON'];

// Fields safe to expose for a student object (never the password hash).
const STUDENT_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  level: true,
  avatarUrl: true,
  createdAt: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Serialize a CalendarEvent row (with optional student/group relations)
 * into a plain object the frontend can consume. JSON columns are parsed.
 */
function serializeEvent(e, req) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    type: e.type,
    mode: e.mode,
    createdById: e.createdById,
    startDate: e.startDate,
    startTime: e.startTime,
    endTime: e.endTime,
    isRecurring: e.isRecurring,
    endDate: e.endDate,
    daysOfWeek: e.daysOfWeek ? safeParse(e.daysOfWeek, []) : [],
    schedules: e.schedules ? safeParse(e.schedules, {}) : {},
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    students: (e.students || []).map((s) => pickStudent(s.student)),
    groups: (e.groups || []).map((g) => g.group),
    videoCall: e.videoCall
      ? {
          id: e.videoCall.id,
          jitsiRoomId: e.videoCall.jitsiRoomId,
          status: e.videoCall.status,
          roomUrl: `${appBaseUrl(req)}/video-calls/room/${e.videoCall.jitsiRoomId}`,
        }
      : null,
  };
}

function pickStudent(student) {
  if (!student) return null;
  const out = {};
  for (const key of Object.keys(STUDENT_FIELDS)) out[key] = student[key];
  return out;
}

function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Validate and normalize an event payload from the client.
 * Returns { ok, error, data }.
 */
function normalizeEventPayload(body) {
  const {
    title,
    description,
    type = 'LESSON',
    mode = 'VIDEO',
    isRecurring = false,
    startDate,
    startTime,
    endTime,
    endDate,
    daysOfWeek,
    schedules,
    studentIds = [],
    groupIds = [],
  } = body || {};

  if (!title || !String(title).trim()) {
    return { ok: false, error: 'Title is required' };
  }
  if (!EVENT_TYPES.includes(type)) {
    return { ok: false, error: 'Invalid event type' };
  }
  if (!EVENT_MODES.includes(mode)) {
    return { ok: false, error: 'Invalid event mode' };
  }
  if (!startDate) {
    return { ok: false, error: 'Start date is required' };
  }

  const data = {
    title: String(title).trim(),
    description: description ? String(description).trim() : null,
    type,
    mode,
    isRecurring: !!isRecurring,
    startDate: new Date(startDate),
    studentIds: Array.isArray(studentIds) ? studentIds : [],
    groupIds: Array.isArray(groupIds) ? groupIds : [],
  };

  if (data.isRecurring) {
    // Recurring: need a range, at least one weekday, and a schedule per weekday.
    if (!endDate) {
      return { ok: false, error: 'End date is required for recurring events' };
    }
    const end = new Date(endDate);
    if (end < data.startDate) {
      return { ok: false, error: 'End date must be on or after the start date' };
    }
    const days = Array.isArray(daysOfWeek) ? daysOfWeek.map(Number).filter((d) => d >= 0 && d <= 6) : [];
    if (days.length === 0) {
      return { ok: false, error: 'Select at least one weekday for recurring events' };
    }
    const sched = schedules && typeof schedules === 'object' ? schedules : {};
    for (const d of days) {
      const s = sched[String(d)];
      if (!s || !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(s)) {
        return { ok: false, error: `A valid time range is required for weekday ${d}` };
      }
    }
    data.endDate = end;
    data.daysOfWeek = JSON.stringify(days);
    data.schedules = JSON.stringify(sched);
    data.startTime = null;
    data.endTime = null;
  } else {
    // One-off: need a date and a time range.
    if (!startTime || !endTime) {
      return { ok: false, error: 'Start and end times are required' };
    }
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return { ok: false, error: 'Times must be in HH:mm format' };
    }
    if (endTime <= startTime) {
      return { ok: false, error: 'End time must be after the start time' };
    }
    data.startTime = startTime;
    data.endTime = endTime;
    data.endDate = null;
    data.daysOfWeek = null;
    data.schedules = null;
  }

  return { ok: true, data };
}

/**
 * Fetch an event with its student and group relations.
 */
async function fetchEventWithRelations(id) {
  return prisma.calendarEvent.findUnique({
    where: { id },
    include: {
      students: { include: { student: true } },
      groups: { include: { group: true } },
      videoCall: true,
    },
  });
}

/**
 * Replace the student/group links of an event with the given id lists.
 */
async function replaceEventParticipants(eventId, studentIds, groupIds) {
  await prisma.calendarEventStudent.deleteMany({ where: { eventId } });
  await prisma.calendarEventGroup.deleteMany({ where: { eventId } });
  if (studentIds.length) {
    await prisma.calendarEventStudent.createMany({
      data: studentIds.map((studentId) => ({ eventId, studentId })),
    });
  }
  if (groupIds.length) {
    await prisma.calendarEventGroup.createMany({
      data: groupIds.map((groupId) => ({ eventId, groupId })),
    });
  }
}

/**
 * Resolve the full list of invited students for an event (direct + groups).
 */
async function resolveInvitedStudents(eventId) {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    include: {
      students: { include: { student: true } },
      groups: { include: { group: { include: { members: { include: { student: true } } } } } },
    },
  });
  if (!event) return [];
  const byId = new Map();
  for (const link of event.students || []) {
    if (link.student) byId.set(link.student.id, link.student);
  }
  for (const link of event.groups || []) {
    for (const member of link.group?.members || []) {
      if (member.student) byId.set(member.student.id, member.student);
    }
  }
  return [...byId.values()];
}

/**
 * Create the VideoCallSession for a CALL/VIDEO event (idempotent) and return
 * the stable join URL.
 */
async function ensureVideoCallSession(event, req) {
  const base = appBaseUrl(req);
  if (event.videoCall) {
    return { session: event.videoCall, url: `${base}/video-calls/room/${event.videoCall.jitsiRoomId}` };
  }
  const jitsiRoomId = `re-${event.id}-${crypto.randomBytes(4).toString('hex')}`;
  const session = await prisma.videoCallSession.create({
    data: {
      eventId: event.id,
      jitsiRoomId,
      hostId: event.createdById,
      status: 'SCHEDULED',
    },
  });
  return { session, url: `${base}/video-calls/room/${jitsiRoomId}` };
}

/**
 * Send the video call invitation email to every invited student that has an
 * email address. Returns per-recipient outcomes.
 */
async function emailVideoCallInvites(event, roomUrl, hostName) {
  const students = await resolveInvitedStudents(event.id);
  const results = [];
  for (const student of students) {
    if (!student.email) {
      results.push({ userId: student.id, email: null, emailSent: false, reason: 'no_email' });
      continue;
    }
    const outcome = await sendVideoCallEmail(student.email, {
      toEmail: student.email,
      title: event.title,
      description: event.description || undefined,
      startDate: event.startDate,
      startTime: event.startTime,
      endTime: event.endTime,
      roomUrl,
      hostName,
    });
    results.push({ userId: student.id, email: student.email, emailSent: outcome.sent, reason: outcome.sent ? null : outcome.reason });
  }
  return results;
}

/**
 * Send a calendar event notification email to every invited student that has
 * an email address (direct + group members). Used for all event types
 * (lessons, in-person calls, recurring events). Returns per-recipient outcomes.
 */
async function emailCalendarInvites(event, hostName) {
  const students = await resolveInvitedStudents(event.id);
  const results = [];
  for (const student of students) {
    if (!student.email) {
      results.push({ userId: student.id, email: null, emailSent: false, reason: 'no_email' });
      continue;
    }
    const outcome = await sendCalendarEventEmail(student.email, {
      title: event.title,
      description: event.description || undefined,
      type: event.type,
      mode: event.mode,
      startDate: event.startDate,
      startTime: event.startTime,
      endTime: event.endTime,
      isRecurring: event.isRecurring,
      endDate: event.endDate,
      daysOfWeek: event.daysOfWeek ? safeParse(event.daysOfWeek, []) : [],
      hostName,
    });
    results.push({ userId: student.id, email: student.email, emailSent: outcome.sent, reason: outcome.sent ? null : outcome.reason });
  }
  return results;
}

/**
 * Create in-app notifications for every invited student.
 */
async function notifyVideoCallInvites(event, roomUrl) {
  const students = await resolveInvitedStudents(event.id);
  const when = event.startTime
    ? `${event.startDate.toISOString().slice(0, 10)} ${event.startTime}`
    : event.startDate.toISOString().slice(0, 10);
  // Always store a relative path so the SPA can navigate() to it directly.
  // (An absolute URL would not match any route and would bounce to home.)
  const linkUrl = toRelativePath(roomUrl);
  await prisma.notification.createMany({
    data: students.map((student) => ({
      userId: student.id,
      title: 'Video Call',
      message: `Προγραμματίστηκε Video Call: ${event.title} (${when})`,
      type: 'VIDEO_CALL',
      linkUrl,
    })),
  });
}

/**
 * Create in-app notifications for every invited student of a non-video-call
 * event (lesson, in-person call). Recurring events include the weekdays and
 * the date range in the message.
 */
async function notifyCalendarInvites(event) {
  const students = await resolveInvitedStudents(event.id);
  if (students.length === 0) return;

  const typeLabel = event.type === 'CALL' ? 'κλήση' : 'μάθημα';
  const modeLabel = event.mode === 'IN_PERSON' ? 'δια ζώσης' : 'online';
  const weekdayNamesEl = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

  let when;
  if (event.isRecurring) {
    const days = (event.daysOfWeek ? safeParse(event.daysOfWeek, []) : [])
      .map((d) => weekdayNamesEl[d])
      .filter(Boolean)
      .join(', ');
    const start = event.startDate.toISOString().slice(0, 10);
    const end = event.endDate ? event.endDate.toISOString().slice(0, 10) : start;
    when = `Επαναλαμβανόμενο (${days}), ${start} έως ${end}`;
  } else {
    const date = event.startDate.toISOString().slice(0, 10);
    when = event.startTime ? `${date} ${event.startTime}-${event.endTime}` : date;
  }

  await prisma.notification.createMany({
    data: students.map((student) => ({
      userId: student.id,
      title: event.type === 'CALL' ? 'Call' : 'Lesson',
      message: `Προγραμματίστηκε ${typeLabel} ${modeLabel}: ${event.title} (${when})`,
      type: 'CALENDAR',
      linkUrl: '/calendar',
    })),
  });
}

/**
 * Check whether a new/updated event overlaps an existing one for the same
 * owner. Returns the conflicting event (or null). Overlap rules:
 *  - one-off vs one-off: same date and time ranges intersect.
 *  - one-off vs recurring: the one-off date falls on a recurring weekday
 *    whose schedule intersects the one-off time range.
 *  - recurring vs recurring: ranges overlap AND they share a weekday whose
 *    schedules intersect.
 */
async function findConflictingEvent(ownerId, data, excludeId) {
  const candidates = await prisma.calendarEvent.findMany({
    where: {
      createdById: ownerId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });

  const toMinutes = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + m;
  };

  const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

  const timeOverlap = (aStart, aEnd, bStart, bEnd) =>
    toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);

  const newIsRecurring = !!data.isRecurring;
  const newStart = new Date(data.startDate);
  const newEnd = data.endDate ? new Date(data.endDate) : new Date(data.startDate);
  const newDays = newIsRecurring ? (data.daysOfWeek ? JSON.parse(data.daysOfWeek) : []) : [];
  const newSchedules = newIsRecurring && data.schedules ? JSON.parse(data.schedules) : {};

  for (const existing of candidates) {
    const exIsRecurring = existing.isRecurring;
    const exStart = new Date(existing.startDate);
    const exEnd = existing.endDate ? new Date(existing.endDate) : new Date(existing.startDate);

    if (!newIsRecurring && !exIsRecurring) {
      // Same date + overlapping time range.
      const sameDate =
        newStart.toISOString().slice(0, 10) === exStart.toISOString().slice(0, 10);
      if (sameDate && timeOverlap(data.startTime, data.endTime, existing.startTime, existing.endTime)) {
        return existing;
      }
    } else if (!newIsRecurring && exIsRecurring) {
      // New one-off falls on a recurring weekday with an overlapping time.
      const weekday = newStart.getDay();
      const exDays = existing.daysOfWeek ? JSON.parse(existing.daysOfWeek) : [];
      const exSchedules = existing.schedules ? JSON.parse(existing.schedules) : {};
      const inRange = newStart >= exStart && newStart <= exEnd;
      const sched = exSchedules[String(weekday)];
      if (inRange && exDays.includes(weekday) && sched) {
        const [sStart, sEnd] = sched.split('-');
        if (timeOverlap(data.startTime, data.endTime, sStart, sEnd)) return existing;
      }
    } else if (newIsRecurring && !exIsRecurring) {
      // Existing one-off falls on a new recurring weekday with an overlapping time.
      const weekday = exStart.getDay();
      const inRange = exStart >= newStart && exStart <= newEnd;
      const sched = newSchedules[String(weekday)];
      if (inRange && newDays.includes(weekday) && sched) {
        const [sStart, sEnd] = sched.split('-');
        if (timeOverlap(sStart, sEnd, existing.startTime, existing.endTime)) return existing;
      }
    } else {
      // Both recurring: ranges overlap AND share a weekday with intersecting schedules.
      if (!rangesOverlap(newStart, newEnd, exStart, exEnd)) continue;
      const exDays = existing.daysOfWeek ? JSON.parse(existing.daysOfWeek) : [];
      const exSchedules = existing.schedules ? JSON.parse(existing.schedules) : {};
      for (const day of newDays) {
        if (!exDays.includes(day)) continue;
        const a = newSchedules[String(day)];
        const b = exSchedules[String(day)];
        if (!a || !b) continue;
        const [aStart, aEnd] = a.split('-');
        const [bStart, bEnd] = b.split('-');
        if (timeOverlap(aStart, aEnd, bStart, bEnd)) return existing;
      }
    }
  }
  return null;
}

// ─── Groups ──────────────────────────────────────────────────────────────────

// GET /api/calendar/groups
// Teacher/Admin: list groups the user owns (admin sees all).
router.get('/groups', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const where = req.user.role === 'ADMIN' ? {} : { createdById: req.user.id };
    const groups = await prisma.group.findMany({
      where,
      include: { members: { include: { student: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        createdById: g.createdById,
        createdAt: g.createdAt,
        students: g.members.map((m) => pickStudent(m.student)),
      })),
    });
  } catch (err) {
    console.error('Calendar groups list error:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// POST /api/calendar/groups
// Teacher/Admin: create a group with an optional list of student ids.
router.post('/groups', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const { name, studentIds = [] } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const group = await prisma.group.create({
      data: {
        name: String(name).trim(),
        createdById: req.user.id,
        members: {
          create: (Array.isArray(studentIds) ? studentIds : []).map((studentId) => ({ studentId })),
        },
      },
      include: { members: { include: { student: true } } },
    });
    res.status(201).json({
      group: {
        id: group.id,
        name: group.name,
        createdById: group.createdById,
        createdAt: group.createdAt,
        students: group.members.map((m) => pickStudent(m.student)),
      },
    });
  } catch (err) {
    console.error('Calendar group create error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PUT /api/calendar/groups/:id
// Teacher/Admin: rename a group and/or replace its members.
router.put('/groups/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (req.user.role !== 'ADMIN' && group.createdById !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own groups' });
    }

    const { name, studentIds } = req.body || {};
    const data = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Group name cannot be empty' });
      data.name = String(name).trim();
    }

    const updated = await prisma.group.update({
      where: { id: group.id },
      data,
      include: { members: { include: { student: true } } },
    });

    if (Array.isArray(studentIds)) {
      await prisma.groupMember.deleteMany({ where: { groupId: group.id } });
      if (studentIds.length) {
        await prisma.groupMember.createMany({
          data: studentIds.map((studentId) => ({ groupId: group.id, studentId })),
        });
      }
      const fresh = await prisma.group.findUnique({
        where: { id: group.id },
        include: { members: { include: { student: true } } },
      });
      updated.members = fresh.members;
    }

    res.json({
      group: {
        id: updated.id,
        name: updated.name,
        createdById: updated.createdById,
        createdAt: updated.createdAt,
        students: updated.members.map((m) => pickStudent(m.student)),
      },
    });
  } catch (err) {
    console.error('Calendar group update error:', err);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE /api/calendar/groups/:id
router.delete('/groups/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (req.user.role !== 'ADMIN' && group.createdById !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own groups' });
    }
    await prisma.group.delete({ where: { id: group.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Calendar group delete error:', err);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ─── Events ──────────────────────────────────────────────────────────────────

// GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD
// Teacher/Admin: events visible to the user (admin sees all, teacher sees own).
// `from`/`to` are inclusive date bounds used to filter one-off events and
// recurring ranges. Omit both to fetch everything the user can see.
router.get('/events', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = {
      ...(req.user.role === 'ADMIN' ? {} : { createdById: req.user.id }),
    };

    if (from || to) {
      const fromDate = from ? new Date(from) : new Date(0);
      const toDate = to ? new Date(to) : new Date(8640000000000000);
      // A one-off event is visible if its date falls in [from, to].
      // A recurring event is visible if its range overlaps [from, to].
      where.OR = [
        { isRecurring: false, startDate: { gte: fromDate, lte: toDate } },
        { isRecurring: true, startDate: { lte: toDate }, endDate: { gte: fromDate } },
      ];
    }

    const events = await prisma.calendarEvent.findMany({
      where,
      include: {
        students: { include: { student: true } },
        groups: { include: { group: true } },
        videoCall: true,
      },
      orderBy: { startDate: 'asc' },
    });

    res.json({ events: events.map((e) => serializeEvent(e, req)) });
  } catch (err) {
    console.error('Calendar events list error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/calendar/my-events
// Any authenticated user (students included). Returns the events the user is
// invited to: direct student participants or members of invited groups.
// Used by the read-only student calendar.
router.get('/my-events', requireAuth, async (req, res) => {
  try {
    const events = await prisma.calendarEvent.findMany({
      where: {
        OR: [
          { students: { some: { studentId: req.user.id } } },
          { groups: { some: { group: { members: { some: { studentId: req.user.id } } } } } },
        ],
      },
      include: {
        students: { include: { student: true } },
        groups: { include: { group: true } },
        videoCall: true,
      },
      orderBy: { startDate: 'asc' },
    });
    res.json({ events: events.map((e) => serializeEvent(e, req)) });
  } catch (err) {
    console.error('Calendar my-events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/calendar/events/:id
router.get('/events/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const event = await fetchEventWithRelations(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (req.user.role !== 'ADMIN' && event.createdById !== req.user.id) {
      return res.status(403).json({ error: 'You can only view your own events' });
    }
    res.json({ event: serializeEvent(event, req) });
  } catch (err) {
    console.error('Calendar event get error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// POST /api/calendar/events
router.post('/events', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const { ok, error, data } = normalizeEventPayload(req.body);
    if (!ok) return res.status(400).json({ error });

    const conflict = await findConflictingEvent(req.user.id, data, null);
    if (conflict) {
      const when = data.isRecurring
        ? `${data.startDate.toISOString().slice(0, 10)} to ${data.endDate.toISOString().slice(0, 10)}`
        : `${data.startDate.toISOString().slice(0, 10)} ${data.startTime}-${data.endTime}`;
      return res.status(409).json({
        error: `Time conflict: ${when} overlaps with "${conflict.title}" (${conflict.type === 'CALL' ? 'Call' : 'Lesson'}).`,
      });
    }

    const event = await prisma.calendarEvent.create({
      data: {
        title: data.title,
        description: data.description,
        type: data.type,
        mode: data.mode,
        createdById: req.user.id,
        startDate: data.startDate,
        startTime: data.startTime,
        endTime: data.endTime,
        isRecurring: data.isRecurring,
        endDate: data.endDate,
        daysOfWeek: data.daysOfWeek,
        schedules: data.schedules,
        students: { create: data.studentIds.map((studentId) => ({ studentId })) },
        groups: { create: data.groupIds.map((groupId) => ({ groupId })) },
      },
      include: {
        students: { include: { student: true } },
        groups: { include: { group: true } },
        videoCall: true,
      },
    });

    // Email every invited student with an email address:
    //  - VIDEO calls: the join link (video call email)
    //  - everything else (lessons, in-person calls, recurring): calendar email
    let emailResults = null;
    const hostName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.username;
    if (event.type === 'CALL' && event.mode === 'VIDEO') {
      const { url } = await ensureVideoCallSession(event, req);
      emailResults = await emailVideoCallInvites(event, url, hostName);
      await notifyVideoCallInvites(event, url);
    } else {
      emailResults = await emailCalendarInvites(event, hostName);
      await notifyCalendarInvites(event);
    }

    const fresh = await fetchEventWithRelations(event.id);
    res.status(201).json({ event: serializeEvent(fresh, req), emailResults });
  } catch (err) {
    console.error('Calendar event create error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// PUT /api/calendar/events/:id
// Editing a recurring event updates the whole series (all occurrences).
router.put('/events/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const existing = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    if (req.user.role !== 'ADMIN' && existing.createdById !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own events' });
    }

    const { ok, error, data } = normalizeEventPayload(req.body);
    if (!ok) return res.status(400).json({ error });

    const conflict = await findConflictingEvent(req.user.id, data, existing.id);
    if (conflict) {
      const when = data.isRecurring
        ? `${data.startDate.toISOString().slice(0, 10)} to ${data.endDate.toISOString().slice(0, 10)}`
        : `${data.startDate.toISOString().slice(0, 10)} ${data.startTime}-${data.endTime}`;
      return res.status(409).json({
        error: `Time conflict: ${when} overlaps with "${conflict.title}" (${conflict.type === 'CALL' ? 'Call' : 'Lesson'}).`,
      });
    }

    const event = await prisma.calendarEvent.update({
      where: { id: existing.id },
      data: {
        title: data.title,
        description: data.description,
        type: data.type,
        mode: data.mode,
        startDate: data.startDate,
        startTime: data.startTime,
        endTime: data.endTime,
        isRecurring: data.isRecurring,
        endDate: data.endDate,
        daysOfWeek: data.daysOfWeek,
        schedules: data.schedules,
      },
      include: {
        students: { include: { student: true } },
        groups: { include: { group: true } },
        videoCall: true,
      },
    });

    await replaceEventParticipants(existing.id, data.studentIds, data.groupIds);

    // Re-notify invitees when the schedule or participants changed:
    //  - VIDEO calls: keep the stable room and re-send the join link
    //  - everything else: send the calendar event email
    let emailResults = null;
    const hostName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.username;
    if (event.type === 'CALL' && event.mode === 'VIDEO') {
      const { url } = await ensureVideoCallSession(event, req);
      emailResults = await emailVideoCallInvites(event, url, hostName);
      await notifyVideoCallInvites(event, url);
    } else {
      emailResults = await emailCalendarInvites(event, hostName);
      await notifyCalendarInvites(event);
    }

    const fresh = await fetchEventWithRelations(existing.id);
    res.json({ event: serializeEvent(fresh, req), emailResults });
  } catch (err) {
    console.error('Calendar event update error:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /api/calendar/events/:id
// For recurring events this deletes the entire series.
router.delete('/events/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const existing = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    if (req.user.role !== 'ADMIN' && existing.createdById !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own events' });
    }
    await prisma.calendarEvent.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Calendar event delete error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

module.exports = router;
