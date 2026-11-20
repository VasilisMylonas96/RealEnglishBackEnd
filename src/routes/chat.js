const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const prisma = require('../prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const presence = require('../presence');
const { publicBaseUrl } = require('../services/urls');
const { getIO } = require('../socket');
const { ageTurning } = require('../services/birthdays');
const { getUploadsDir } = require('../services/uploadsPath');

const router = express.Router();

const UPLOADS_DIR = getUploadsDir();

// Allowed chat attachments: photos (jpeg/png/webp/gif/avif), PDF and Word docs.
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif|avif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_MIME.test(file.mimetype);
    cb(ok ? null : new Error('Only images, PDF and Word files are allowed'), ok);
  },
});

// Fields safe to expose for a chat contact (never the password hash).
const CONTACT_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  role: true,
  level: true,
  avatarUrl: true,
};

function pickContact(user) {
  if (!user) return null;
  const out = {};
  for (const key of Object.keys(CONTACT_FIELDS)) out[key] = user[key];
  return out;
}

function serializeConversation(conversation, currentUserId) {
  const other =
    conversation.participantOneId === currentUserId
      ? conversation.participantTwo
      : conversation.participantOne;
  return {
    id: conversation.id,
    otherUser: pickContact(other),
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
  };
}

/**
 * Resolve the deterministic participant pair (lower id first) so the
 * @@unique([participantOneId, participantTwoId]) constraint holds.
 */
function participantPair(userAId, userBId) {
  return userAId < userBId
    ? { participantOneId: userAId, participantTwoId: userBId }
    : { participantOneId: userBId, participantTwoId: userAId };
}

/**
 * GET /api/chat/contacts
 * Role-based contact list:
 *  - STUDENT: all Admins + Teachers (default contacts) plus accepted
 *    student friends. Also returns incoming pending friendship requests.
 *  - TEACHER/ADMIN: all students plus other teachers/admins.
 */
router.get('/contacts', requireAuth, async (req, res) => {
  try {
    const me = req.user;
    const isStaff = me.role === 'TEACHER' || me.role === 'ADMIN';

    let contacts = [];
    let incomingRequests = [];

    if (isStaff) {
      // Staff see every user except themselves.
      const users = await prisma.user.findMany({
        where: { id: { not: me.id } },
        select: CONTACT_FIELDS,
        orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      });
      contacts = users.map((u) => ({ ...u, friendshipStatus: 'FRIENDS' }));
    } else {
      // Students: default contacts = all staff.
      const staff = await prisma.user.findMany({
        where: { role: { in: ['TEACHER', 'ADMIN'] } },
        select: CONTACT_FIELDS,
        orderBy: { firstName: 'asc' },
      });
      contacts = staff.map((u) => ({ ...u, friendshipStatus: 'FRIENDS' }));

      // Accepted student friends.
      const friendships = await prisma.friendship.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [{ requesterId: me.id }, { addresseeId: me.id }],
        },
        include: {
          requester: { select: CONTACT_FIELDS },
          addressee: { select: CONTACT_FIELDS },
        },
      });
      const friendIds = new Set(contacts.map((c) => c.id));
      for (const f of friendships) {
        const friend = f.requesterId === me.id ? f.addressee : f.requester;
        if (friend && !friendIds.has(friend.id)) {
          contacts.push({ ...friend, friendshipStatus: 'FRIENDS' });
          friendIds.add(friend.id);
        }
      }

      // Incoming pending requests (for the Requests tab).
      const pending = await prisma.friendship.findMany({
        where: { addresseeId: me.id, status: 'PENDING' },
        include: { requester: { select: CONTACT_FIELDS } },
        orderBy: { createdAt: 'desc' },
      });
      incomingRequests = pending.map((f) => ({
        id: f.id,
        requester: pickContact(f.requester),
        createdAt: f.createdAt,
      }));
    }

    // Per-contact unread counts: messages from that contact in a 1-to-1
    // conversation that I have not read yet.
    const unreadRows = await prisma.message.groupBy({
      by: ['senderId'],
      where: {
        senderId: { not: me.id },
        isRead: false,
        conversation: {
          OR: [{ participantOneId: me.id }, { participantTwoId: me.id }],
        },
      },
      _count: { _all: true },
    });
    const unreadByUser = new Map(unreadRows.map((r) => [r.senderId, r._count._all]));
    contacts = contacts.map((c) => ({
      ...c,
      unreadCount: unreadByUser.get(c.id) || 0,
    }));

    res.json({ contacts, incomingRequests });
  } catch (err) {
    console.error('Chat contacts error:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

/**
 * GET /api/chat/presence
 * Authenticated. Returns the live presence status of every user:
 * { [userId]: 'ONLINE' | 'AWAY' | 'IN_CALL' | 'OFFLINE' }
 * Online/away/in-call come from the in-memory presence map; everyone else
 * is offline (their lastSeenAt is available via the user record if needed).
 */
router.get('/presence', requireAuth, async (req, res) => {
  try {
    const users = await prisma.user.findMany({ select: { id: true } });
    const map = {};
    for (const u of users) {
      map[u.id] = presence.statusOf(u.id);
    }
    res.json({ presence: map });
  } catch (err) {
    console.error('Chat presence error:', err);
    res.status(500).json({ error: 'Failed to fetch presence' });
  }
});

/**
 * POST /api/chat/upload
 * Authenticated. multipart/form-data with field `file`.
 * Accepts photos (jpeg/png/webp/gif/avif), PDF and Word documents.
 * Photos are optimized to WebP; documents are stored as-is.
 * Returns: { attachment: { id, name, mimeType, size, url, kind } }
 */
router.post('/upload', requireAuth, chatUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided (field name: file)' });
    }
    const isImage = /^image\//.test(req.file.mimetype);
    const ext = isImage
      ? '.webp'
      : (path.extname(req.file.originalname) || '.bin').toLowerCase().replace(/[^a-z0-9.]/g, '');
    const filename = `chat-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const target = path.join(UPLOADS_DIR, filename);

    let size = req.file.size;
    if (isImage) {
      // Optimize photos to WebP (max 1920px wide) to keep chat payloads small.
      const sharp = require('sharp');
      const metadata = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(target);
      size = metadata.size;
    } else {
      fs.writeFileSync(target, req.file.buffer);
    }

    res.status(201).json({
      attachment: {
        id: crypto.randomBytes(8).toString('hex'),
        name: req.file.originalname,
        mimeType: isImage ? 'image/webp' : req.file.mimetype,
        size,
        url: `${publicBaseUrl(req)}/uploads/${filename}`,
        kind: isImage ? 'image' : 'file',
      },
    });
  } catch (err) {
    console.error('Chat upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * GET /api/chat/users/search?q=...
 * Search students by firstName, lastName or username (case-insensitive).
 * Returns the friendship status relative to the current user:
 * NONE | PENDING_SENT | PENDING_RECEIVED | FRIENDS | SELF
 */
router.get('/users/search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ users: [] });
    if (req.user.role === 'STUDENT') {
      // Students can only search other students.
      const users = await prisma.user.findMany({
        where: {
          role: 'STUDENT',
          id: { not: req.user.id },
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { username: { contains: q } },
          ],
        },
        select: CONTACT_FIELDS,
        take: 20,
      });
      const friendships = await prisma.friendship.findMany({
        where: {
          OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }],
        },
      });
      const statusMap = new Map();
      for (const f of friendships) {
        if (f.status === 'ACCEPTED') {
          statusMap.set(f.requesterId === req.user.id ? f.addresseeId : f.requesterId, 'FRIENDS');
        } else if (f.status === 'PENDING') {
          if (f.requesterId === req.user.id) {
            statusMap.set(f.addresseeId, 'PENDING_SENT');
          } else {
            statusMap.set(f.requesterId, 'PENDING_RECEIVED');
          }
        }
      }
      res.json({
        users: users.map((u) => ({
          ...u,
          friendshipStatus: statusMap.get(u.id) || 'NONE',
        })),
      });
    } else {
      // Staff can search anyone (they are already contacts).
      const users = await prisma.user.findMany({
        where: {
          id: { not: req.user.id },
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { username: { contains: q } },
          ],
        },
        select: CONTACT_FIELDS,
        take: 20,
      });
      res.json({ users: users.map((u) => ({ ...u, friendshipStatus: 'FRIENDS' })) });
    }
  } catch (err) {
    console.error('Chat search error:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

/**
 * POST /api/chat/friends/request  { addresseeId }
 * Student-to-student friendship request.
 */
router.post('/friends/request', requireAuth, async (req, res) => {
  try {
    const { addresseeId } = req.body || {};
    if (!addresseeId || addresseeId === req.user.id) {
      return res.status(400).json({ error: 'Invalid recipient' });
    }
    const addressee = await prisma.user.findUnique({ where: { id: addresseeId } });
    if (!addressee || addressee.role !== 'STUDENT') {
      return res.status(400).json({ error: 'You can only add students as friends' });
    }
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId },
          { requesterId: addresseeId, addresseeId: req.user.id },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'ACCEPTED') {
        return res.status(409).json({ error: 'Already friends' });
      }
      if (existing.status === 'PENDING') {
        return res.status(409).json({ error: 'A friendship request is already pending' });
      }
      // REJECTED -> allow a fresh request.
      await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'PENDING', requesterId: req.user.id, addresseeId },
      });
      return res.json({ ok: true, friendship: existing });
    }
    const friendship = await prisma.friendship.create({
      data: { requesterId: req.user.id, addresseeId, status: 'PENDING' },
    });
    res.status(201).json({ ok: true, friendship });
  } catch (err) {
    console.error('Friend request error:', err);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

/**
 * PATCH /api/chat/friends/respond  { friendshipId, accept: boolean }
 * Accept or reject an incoming friendship request.
 */
router.patch('/friends/respond', requireAuth, async (req, res) => {
  try {
    const { friendshipId, accept } = req.body || {};
    const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!friendship) return res.status(404).json({ error: 'Request not found' });
    if (friendship.addresseeId !== req.user.id) {
      return res.status(403).json({ error: 'You can only respond to your own requests' });
    }
    if (friendship.status !== 'PENDING') {
      return res.status(409).json({ error: 'Request already handled' });
    }
    const updated = await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: accept ? 'ACCEPTED' : 'REJECTED' },
    });
    res.json({ ok: true, friendship: updated });
  } catch (err) {
    console.error('Friend respond error:', err);
    res.status(500).json({ error: 'Failed to respond to request' });
  }
});

/**
 * GET /api/chat/conversations/:userId
 * Find or create the 1-to-1 conversation with the given user.
 * Returns the conversation plus the other user's profile.
 */
router.get('/conversations/:userId', requireAuth, async (req, res) => {
  try {
    const otherId = req.params.userId;
    if (otherId === req.user.id) {
      return res.status(400).json({ error: 'Cannot chat with yourself' });
    }
    const other = await prisma.user.findUnique({ where: { id: otherId } });
    if (!other) return res.status(404).json({ error: 'User not found' });

    // Visibility: students may only chat with staff or accepted friends.
    if (req.user.role === 'STUDENT' && other.role === 'STUDENT') {
      const friendship = await prisma.friendship.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { requesterId: req.user.id, addresseeId: otherId },
            { requesterId: otherId, addresseeId: req.user.id },
          ],
        },
      });
      if (!friendship) {
        return res.status(403).json({ error: 'You must be friends to chat' });
      }
    }

    const pair = participantPair(req.user.id, otherId);
    let conversation = await prisma.conversation.findUnique({
      where: {
        participantOneId_participantTwoId: pair,
      },
      include: {
        participantOne: { select: CONTACT_FIELDS },
        participantTwo: { select: CONTACT_FIELDS },
      },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { ...pair, lastMessageAt: new Date() },
        include: {
          participantOne: { select: CONTACT_FIELDS },
          participantTwo: { select: CONTACT_FIELDS },
        },
      });
    }
    res.json({ conversation: serializeConversation(conversation, req.user.id) });
  } catch (err) {
    console.error('Conversation get error:', err);
    res.status(500).json({ error: 'Failed to open conversation' });
  }
});

/**
 * GET /api/chat/birthday/:userId
 * Authenticated. Returns the basic profile of a user for the birthday
 * celebration modal (avatar, name, birthDate, age).
 * Visibility mirrors chat: staff can view any user; a student may only view
 * staff or an accepted friend.
 */
router.get('/birthday/:userId', requireAuth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        role: true,
        level: true,
        avatarUrl: true,
        birthDate: true,
      },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (req.user.role === 'STUDENT' && target.role === 'STUDENT') {
      const friendship = await prisma.friendship.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { requesterId: req.user.id, addresseeId: targetId },
            { requesterId: targetId, addresseeId: req.user.id },
          ],
        },
      });
      if (!friendship) {
        return res.status(403).json({ error: 'You must be friends to view this' });
      }
    }

    res.json({
      user: {
        ...target,
        age: ageTurning(target.birthDate),
      },
    });
  } catch (err) {
    console.error('Birthday profile error:', err);
    res.status(500).json({ error: 'Failed to load birthday profile' });
  }
});

/**
 * POST /api/chat/birthday/:userId/message
 * Authenticated. Sends a birthday message to the target user through the
 * 1-to-1 conversation (created if needed) and pushes it in real time.
 * Body: { content } — the message text (auto or custom).
 * Visibility mirrors chat: staff can message any user; a student may only
 * message staff or an accepted friend.
 */
router.post('/birthday/:userId/message', requireAuth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'Cannot send a message to yourself' });
    }
    const content = String((req.body || {}).content || '').trim();
    if (!content) return res.status(400).json({ error: 'Message content is required' });

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (req.user.role === 'STUDENT' && target.role === 'STUDENT') {
      const friendship = await prisma.friendship.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { requesterId: req.user.id, addresseeId: targetId },
            { requesterId: targetId, addresseeId: req.user.id },
          ],
        },
      });
      if (!friendship) {
        return res.status(403).json({ error: 'You must be friends to message this user' });
      }
    }

    const pair = participantPair(req.user.id, targetId);
    let conversation = await prisma.conversation.findUnique({
      where: { participantOneId_participantTwoId: pair },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { ...pair, lastMessageAt: new Date() },
      });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: req.user.id,
        content,
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    const serialized = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      attachments: [],
      isEdited: false,
      lastEditedBy: null,
      editHistory: [],
      isRead: false,
      readBy: [],
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };

    const io = getIO();
    if (io) {
      io.to(`user:${req.user.id}`).emit('chat:receive_message', serialized);
      io.to(`user:${targetId}`).emit('chat:receive_message', serialized);
    }

    res.json({ ok: true, message: serialized });
  } catch (err) {
    console.error('Birthday message error:', err);
    res.status(500).json({ error: 'Failed to send birthday message' });
  }
});

/**
 * GET /api/chat/conversations/:conversationId/messages?cursor=...&limit=25
 * Cursor-based pagination (cursor = oldest loaded message id).
 * Returns messages newest-first internally, but the client reverses them.
 */
router.get('/conversations/:conversationId/messages', requireAuth, async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (
      conversation.participantOneId !== req.user.id &&
      conversation.participantTwoId !== req.user.id
    ) {
      return res.status(403).json({ error: 'You are not part of this conversation' });
    }

    const limit = Math.min(parseInt(req.query.limit || '25', 10) || 25, 50);
    const cursor = req.query.cursor || null;

    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit,
    });

    // Mark messages from the other participant as read.
    await prisma.message.updateMany({
      where: {
        conversationId: conversation.id,
        senderId: { not: req.user.id },
        isRead: false,
      },
      data: { isRead: true },
    });

    res.json({
      messages: messages.reverse().map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        content: m.content,
        attachments: m.attachments ? JSON.parse(m.attachments) : [],
        isEdited: m.isEdited,
        lastEditedBy: m.lastEditedBy,
        editHistory: m.editHistory ? JSON.parse(m.editHistory) : [],
        isRead: m.isRead,
        readBy: [],
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
      hasMore: messages.length === limit,
    });
  } catch (err) {
    console.error('Messages list error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ─── Chat Groups (independent from calendar groups) ────────────────────────

// Fields safe to expose for a chat group.
function serializeGroup(group, currentUserId) {
  return {
    id: group.id,
    name: group.name,
    createdById: group.createdById,
    isOwner: group.createdById === currentUserId,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    students: (group.members || []).map((m) => pickContact(m.student)),
    lastMessageAt: group.lastMessageAt || group.createdAt,
  };
}

/**
 * GET /api/chat/groups
 * Teacher/Admin: groups they own (admin sees all). Students: groups they
 * are members of. Returns the group with its student members.
 */
router.get('/groups', requireAuth, async (req, res) => {
  try {
    const isStaff = req.user.role === 'TEACHER' || req.user.role === 'ADMIN';
    const where = isStaff
      ? req.user.role === 'ADMIN'
        ? {}
        : { createdById: req.user.id }
      : { members: { some: { studentId: req.user.id } } };

    const groups = await prisma.chatGroup.findMany({
      where,
      include: {
        members: { include: { student: { select: CONTACT_FIELDS } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({
      groups: groups.map((g) => serializeGroup({ ...g, lastMessageAt: g.messages[0]?.createdAt }, req.user.id)),
    });
  } catch (err) {
    console.error('Chat groups list error:', err);
    res.status(500).json({ error: 'Failed to fetch chat groups' });
  }
});

/**
 * POST /api/chat/groups  { name, studentIds }
 * Teacher/Admin only. Creates a chat group with the given students.
 */
router.post('/groups', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const { name, studentIds = [] } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const ids = [...new Set(Array.isArray(studentIds) ? studentIds : [])];
    if (ids.length === 0) {
      return res.status(400).json({ error: 'Select at least one student' });
    }
    const students = await prisma.user.findMany({
      where: { id: { in: ids }, role: 'STUDENT' },
      select: { id: true },
    });
    if (students.length === 0) {
      return res.status(400).json({ error: 'No valid students selected' });
    }

    const group = await prisma.chatGroup.create({
      data: {
        name: String(name).trim(),
        createdById: req.user.id,
        members: { create: students.map((s) => ({ studentId: s.id })) },
      },
      include: {
        members: { include: { student: { select: CONTACT_FIELDS } } },
      },
    });
    res.status(201).json({ group: serializeGroup(group, req.user.id) });
  } catch (err) {
    console.error('Chat group create error:', err);
    res.status(500).json({ error: 'Failed to create chat group' });
  }
});

/**
 * PUT /api/chat/groups/:id  { name?, studentIds? }
 * Teacher/Admin only. Renames the group and/or replaces its members.
 */
router.put('/groups/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const group = await prisma.chatGroup.findUnique({ where: { id: req.params.id } });
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
    if (studentIds !== undefined) {
      const ids = [...new Set(Array.isArray(studentIds) ? studentIds : [])];
      const students = await prisma.user.findMany({
        where: { id: { in: ids }, role: 'STUDENT' },
        select: { id: true },
      });
      await prisma.chatGroupMember.deleteMany({ where: { groupId: group.id } });
      if (students.length) {
        await prisma.chatGroupMember.createMany({
          data: students.map((s) => ({ groupId: group.id, studentId: s.id })),
        });
      }
    }

    const updated = await prisma.chatGroup.update({
      where: { id: group.id },
      data,
      include: {
        members: { include: { student: { select: CONTACT_FIELDS } } },
      },
    });
    res.json({ group: serializeGroup(updated, req.user.id) });
  } catch (err) {
    console.error('Chat group update error:', err);
    res.status(500).json({ error: 'Failed to update chat group' });
  }
});

/**
 * DELETE /api/chat/groups/:id
 * Teacher/Admin only. Deletes the group and all its messages.
 */
router.delete('/groups/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const group = await prisma.chatGroup.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (req.user.role !== 'ADMIN' && group.createdById !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own groups' });
    }
    await prisma.chatGroup.delete({ where: { id: group.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Chat group delete error:', err);
    res.status(500).json({ error: 'Failed to delete chat group' });
  }
});

/**
 * GET /api/chat/groups/:id/messages?cursor=...&limit=25
 * Members and the owner can read the group history (cursor pagination).
 */
router.get('/groups/:id/messages', requireAuth, async (req, res) => {
  try {
    const group = await prisma.chatGroup.findUnique({
      where: { id: req.params.id },
      include: { members: { select: { studentId: true } } },
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const isMember = group.members.some((m) => m.studentId === req.user.id);
    const isOwner = group.createdById === req.user.id;
    if (!isMember && !isOwner) {
      return res.status(403).json({ error: 'You are not part of this group' });
    }

    const limit = Math.min(parseInt(req.query.limit || '25', 10) || 25, 50);
    const cursor = req.query.cursor || null;

    const messages = await prisma.chatGroupMessage.findMany({
      where: {
        groupId: group.id,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit,
      include: {
        sender: { select: CONTACT_FIELDS },
        readBy: { select: { userId: true, readAt: true } },
      },
    });

    res.json({
      messages: messages.reverse().map((m) => ({
        id: m.id,
        groupId: m.groupId,
        senderId: m.senderId,
        sender: pickContact(m.sender),
        content: m.content,
        isEdited: m.isEdited,
        lastEditedBy: m.lastEditedBy,
        editHistory: m.editHistory ? JSON.parse(m.editHistory) : [],
        attachments: m.attachments ? JSON.parse(m.attachments) : [],
        readBy: (m.readBy || []).map((r) => ({ userId: r.userId, readAt: r.readAt })),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
      hasMore: messages.length === limit,
    });
  } catch (err) {
    console.error('Chat group messages error:', err);
    res.status(500).json({ error: 'Failed to fetch group messages' });
  }
});

/**
 * GET /api/chat/unread
 * Authenticated. Returns the total number of unread messages across all
 * 1-to-1 conversations and chat groups for the current user, plus the list
 * of distinct users who have unread 1-to-1 messages for me.
 * Response: { unread: number, unreadSenderIds: string[] }
 */
router.get('/unread', requireAuth, async (req, res) => {
  try {
    const me = req.user;

    // 1-to-1: messages from others that are not read.
    const dmUnread = await prisma.message.count({
      where: {
        senderId: { not: me.id },
        isRead: false,
        conversation: {
          OR: [{ participantOneId: me.id }, { participantTwoId: me.id }],
        },
      },
    });

    // Distinct users who have unread 1-to-1 messages for me (drives the
    // dock badge: "how many people sent me unread messages").
    const dmSenderRows = await prisma.message.groupBy({
      by: ['senderId'],
      where: {
        senderId: { not: me.id },
        isRead: false,
        conversation: {
          OR: [{ participantOneId: me.id }, { participantTwoId: me.id }],
        },
      },
    });
    const unreadSenderIds = dmSenderRows.map((r) => r.senderId);

    // Groups: messages from others that this user has no read receipt for.
    const groupUnread = await prisma.chatGroupMessage.count({
      where: {
        senderId: { not: me.id },
        readBy: { none: { userId: me.id } },
        group: {
          OR: [
            { createdById: me.id },
            { members: { some: { studentId: me.id } } },
          ],
        },
      },
    });

    res.json({ unread: dmUnread + groupUnread, unreadSenderIds });
  } catch (err) {
    console.error('Chat unread error:', err);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

module.exports = router;
