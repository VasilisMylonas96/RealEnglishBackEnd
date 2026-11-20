const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const prisma = require('./prisma');
const presence = require('./presence');
const signaling = require('./signaling');

/**
 * Attach Socket.io to the HTTP server with JWT authentication.
 * Every authenticated socket joins a personal room `user:${userId}` so we
 * can push real-time events (messages, edits, friend requests) to exactly
 * the right users.
 */
let ioInstance = null;

/**
 * Returns the active Socket.io server instance (set by attachSocketIO).
 * Used by HTTP routes that need to push real-time events (e.g. birthday
 * messages) to a specific user's personal room.
 */
function getIO() {
  return ioInstance;
}

function attachSocketIO(server, allowedOrigins) {
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });
  ioInstance = io;

  // JWT auth middleware for sockets.
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
        null;
      if (!token) return next(new Error('Authentication required'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id: payload.sub, role: payload.role, username: payload.username };
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);

    // ---- Presence ----
    // Mark the user as connected and online.
    presence.presence.set(userId, { lastActivity: Date.now(), inCall: false, lastStatus: 'ONLINE' });
    presence.startTimers(io);
    presence.broadcast(io, userId, presence.statusOf(userId));

    // Client reports activity (mouse/keyboard/focus) to stay "online".
    socket.on('presence:activity', () => {
      const before = presence.statusOf(userId);
      presence.touch(userId);
      const after = presence.statusOf(userId);
      if (before !== after) presence.broadcast(io, userId, after);
    });

    // Client reports entering/leaving a video call.
    socket.on('presence:call', (inCall) => {
      const before = presence.statusOf(userId);
      presence.setInCall(userId, inCall);
      const after = presence.statusOf(userId);
      if (before !== after) presence.broadcast(io, userId, after);
    });

    // ---- WebRTC signaling (video calls) ----
    // Track the rooms this socket has joined so we can leave them on
    // disconnect. A user may be in at most one call at a time, but we keep a
    // Set so a stray double-join never leaks a room.
    const joinedRooms = new Set();

    // Join a call room. The client sends its display name and host flag; the
    // ack returns the current peer list so it can initiate WebRTC connections.
    socket.on('rtc:join', (payload, ack) => {
      try {
        const roomId = payload?.roomId;
        if (!roomId || typeof roomId !== 'string') {
          return ack?.({ ok: false, error: 'roomId is required' });
        }
        const peers = signaling.join(io, roomId, userId, {
          displayName: payload.displayName,
          isHost: payload.isHost,
          socketId: socket.id,
        });
        joinedRooms.add(roomId);
        ack?.({ ok: true, roomId, peers });
      } catch (err) {
        console.error('rtc:join error:', err);
        ack?.({ ok: false, error: 'Failed to join room' });
      }
    });

    // Explicitly leave a room (e.g. the user clicks "End call").
    socket.on('rtc:leave', (payload) => {
      const roomId = payload?.roomId;
      if (!roomId) return;
      signaling.leave(io, roomId, userId, socket.id);
      joinedRooms.delete(roomId);
    });

    // Relay a signaling message (SDP offer/answer or ICE candidate) to a
    // specific peer in the same room.
    socket.on('rtc:signal', (payload) => {
      const { roomId, to, data } = payload || {};
      if (!roomId || !to) return;
      signaling.relay(io, roomId, userId, to, data);
    });

    // Send a message. The conversation must exist and the sender must be a
    // participant. Persists, then emits to both participants.
    socket.on('chat:send_message', async (payload, ack) => {
      try {
        const { conversationId, content, attachments } = payload || {};
        const text = content ? String(content).trim() : '';
        const files = Array.isArray(attachments) ? attachments : [];
        if (!conversationId || (!text && files.length === 0)) {
          return ack?.({ ok: false, error: 'Message content is required' });
        }
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
        });
        if (!conversation) return ack?.({ ok: false, error: 'Conversation not found' });
        if (
          conversation.participantOneId !== userId &&
          conversation.participantTwoId !== userId
        ) {
          return ack?.({ ok: false, error: 'You are not part of this conversation' });
        }

        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: userId,
            content: text,
            attachments: files.length ? JSON.stringify(files) : null,
          },
        });
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        });

        const serialized = {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          content: message.content,
          attachments: message.attachments ? JSON.parse(message.attachments) : [],
          isEdited: false,
          lastEditedBy: null,
          editHistory: [],
          isRead: false,
          readBy: [],
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        };

        const otherId =
          conversation.participantOneId === userId
            ? conversation.participantTwoId
            : conversation.participantOneId;

        io.to(`user:${userId}`).emit('chat:receive_message', serialized);
        io.to(`user:${otherId}`).emit('chat:receive_message', serialized);
        ack?.({ ok: true, message: serialized });
      } catch (err) {
        console.error('Socket send_message error:', err);
        ack?.({ ok: false, error: 'Failed to send message' });
      }
    });

    // Edit a message. Both participants may edit (edit-only policy, no delete).
    socket.on('chat:edit_message', async (payload, ack) => {
      try {
        const { messageId, content } = payload || {};
        if (!messageId || !content || !String(content).trim()) {
          return ack?.({ ok: false, error: 'Message content is required' });
        }
        const message = await prisma.message.findUnique({
          where: { id: messageId },
          include: { conversation: true },
        });
        if (!message) return ack?.({ ok: false, error: 'Message not found' });
        const conversation = message.conversation;
        if (
          conversation.participantOneId !== userId &&
          conversation.participantTwoId !== userId
        ) {
          return ack?.({ ok: false, error: 'You are not part of this conversation' });
        }

        const history = message.editHistory ? JSON.parse(message.editHistory) : [];
        history.push({
          previousContent: message.content,
          editedBy: userId,
          editedAt: new Date().toISOString(),
        });

        const updated = await prisma.message.update({
          where: { id: messageId },
          data: {
            content: String(content).trim(),
            isEdited: true,
            lastEditedBy: userId,
            editHistory: JSON.stringify(history),
          },
        });

        const serialized = {
          id: updated.id,
          conversationId: updated.conversationId,
          senderId: updated.senderId,
          content: updated.content,
          attachments: updated.attachments ? JSON.parse(updated.attachments) : [],
          isEdited: updated.isEdited,
          lastEditedBy: updated.lastEditedBy,
          editHistory: history,
          isRead: updated.isRead,
          readBy: [],
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };

        const otherId =
          conversation.participantOneId === userId
            ? conversation.participantTwoId
            : conversation.participantOneId;

        io.to(`user:${userId}`).emit('chat:message_edited', serialized);
        io.to(`user:${otherId}`).emit('chat:message_edited', serialized);
        ack?.({ ok: true, message: serialized });
      } catch (err) {
        console.error('Socket edit_message error:', err);
        ack?.({ ok: false, error: 'Failed to edit message' });
      }
    });

    // Mark messages as read. The client emits this when a conversation is
    // opened/focused. Marks all messages from the other participant as read
    // and notifies the sender in real time (read receipts).
    socket.on('chat:mark_read', async (payload, ack) => {
      try {
        const { conversationId } = payload || {};
        if (!conversationId) return ack?.({ ok: false, error: 'conversationId is required' });
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
        });
        if (!conversation) return ack?.({ ok: false, error: 'Conversation not found' });
        if (
          conversation.participantOneId !== userId &&
          conversation.participantTwoId !== userId
        ) {
          return ack?.({ ok: false, error: 'You are not part of this conversation' });
        }

        const updated = await prisma.message.updateMany({
          where: {
            conversationId,
            senderId: { not: userId },
            isRead: false,
          },
          data: { isRead: true },
        });

        if (updated.count > 0) {
          const otherId =
            conversation.participantOneId === userId
              ? conversation.participantTwoId
              : conversation.participantOneId;
          io.to(`user:${otherId}`).emit('chat:messages_read', {
            conversationId,
            readerId: userId,
            count: updated.count,
          });
        }
        ack?.({ ok: true, count: updated.count });
      } catch (err) {
        console.error('Socket mark_read error:', err);
        ack?.({ ok: false, error: 'Failed to mark messages as read' });
      }
    });

    // Send a message to a chat group. The sender must be the owner or a
    // member. Persists, then emits to the owner and every member.
    socket.on('chat:group_send_message', async (payload, ack) => {
      try {
        const { groupId, content, attachments } = payload || {};
        const text = content ? String(content).trim() : '';
        const files = Array.isArray(attachments) ? attachments : [];
        if (!groupId || (!text && files.length === 0)) {
          return ack?.({ ok: false, error: 'Message content is required' });
        }
        const group = await prisma.chatGroup.findUnique({
          where: { id: groupId },
          include: { members: { select: { studentId: true } } },
        });
        if (!group) return ack?.({ ok: false, error: 'Group not found' });
        const isMember = group.members.some((m) => m.studentId === userId);
        if (!isMember && group.createdById !== userId) {
          return ack?.({ ok: false, error: 'You are not part of this group' });
        }

        const message = await prisma.chatGroupMessage.create({
          data: {
            groupId,
            senderId: userId,
            content: text,
            attachments: files.length ? JSON.stringify(files) : null,
          },
          include: { sender: { select: { id: true, firstName: true, lastName: true, username: true, role: true, level: true, avatarUrl: true } } },
        });
        await prisma.chatGroup.update({
          where: { id: groupId },
          data: { updatedAt: new Date() },
        });

        const serialized = {
          id: message.id,
          groupId: message.groupId,
          senderId: message.senderId,
          sender: message.sender,
          content: message.content,
          attachments: message.attachments ? JSON.parse(message.attachments) : [],
          isEdited: false,
          lastEditedBy: null,
          editHistory: [],
          readBy: [],
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        };

        // Deliver to the owner and every member.
        const recipients = new Set([group.createdById, ...group.members.map((m) => m.studentId)]);
        for (const recipientId of recipients) {
          io.to(`user:${recipientId}`).emit('chat:group_receive_message', serialized);
        }
        ack?.({ ok: true, message: serialized });
      } catch (err) {
        console.error('Socket group_send_message error:', err);
        ack?.({ ok: false, error: 'Failed to send group message' });
      }
    });

    // Edit a group message. Owner and members may edit (edit-only policy).
    socket.on('chat:group_edit_message', async (payload, ack) => {
      try {
        const { messageId, content } = payload || {};
        if (!messageId || !content || !String(content).trim()) {
          return ack?.({ ok: false, error: 'Message content is required' });
        }
        const message = await prisma.chatGroupMessage.findUnique({
          where: { id: messageId },
          include: { group: { include: { members: { select: { studentId: true } } } } },
        });
        if (!message) return ack?.({ ok: false, error: 'Message not found' });
        const group = message.group;
        const isMember = group.members.some((m) => m.studentId === userId);
        if (!isMember && group.createdById !== userId) {
          return ack?.({ ok: false, error: 'You are not part of this group' });
        }

        const history = message.editHistory ? JSON.parse(message.editHistory) : [];
        history.push({
          previousContent: message.content,
          editedBy: userId,
          editedAt: new Date().toISOString(),
        });

        const updated = await prisma.chatGroupMessage.update({
          where: { id: messageId },
          data: {
            content: String(content).trim(),
            isEdited: true,
            lastEditedBy: userId,
            editHistory: JSON.stringify(history),
          },
          include: { sender: { select: { id: true, firstName: true, lastName: true, username: true, role: true, level: true, avatarUrl: true } } },
        });

        const serialized = {
          id: updated.id,
          groupId: updated.groupId,
          senderId: updated.senderId,
          sender: updated.sender,
          content: updated.content,
          attachments: updated.attachments ? JSON.parse(updated.attachments) : [],
          isEdited: updated.isEdited,
          lastEditedBy: updated.lastEditedBy,
          editHistory: history,
          readBy: [],
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };

        const recipients = new Set([group.createdById, ...group.members.map((m) => m.studentId)]);
        for (const recipientId of recipients) {
          io.to(`user:${recipientId}`).emit('chat:group_message_edited', serialized);
        }
        ack?.({ ok: true, message: serialized });
      } catch (err) {
        console.error('Socket group_edit_message error:', err);
        ack?.({ ok: false, error: 'Failed to edit group message' });
      }
    });

    // Mark group messages as read. The client emits this when a group chat
    // is opened/focused. Records a read receipt per message and notifies the
    // sender in real time.
    socket.on('chat:group_mark_read', async (payload, ack) => {
      try {
        const { groupId } = payload || {};
        if (!groupId) return ack?.({ ok: false, error: 'groupId is required' });
        const group = await prisma.chatGroup.findUnique({
          where: { id: groupId },
          include: { members: { select: { studentId: true } } },
        });
        if (!group) return ack?.({ ok: false, error: 'Group not found' });
        const isMember = group.members.some((m) => m.studentId === userId);
        if (!isMember && group.createdById !== userId) {
          return ack?.({ ok: false, error: 'You are not part of this group' });
        }

        // Messages from others that this user hasn't read yet.
        const unread = await prisma.chatGroupMessage.findMany({
          where: {
            groupId,
            senderId: { not: userId },
            readBy: { none: { userId } },
          },
          select: { id: true, senderId: true },
        });

        if (unread.length) {
          // Create each read receipt individually and ignore
          // unique-constraint errors (idempotent across all databases).
          for (const m of unread) {
            try {
              await prisma.chatGroupMessageRead.create({
                data: { messageId: m.id, userId },
              });
            } catch {
              /* already read — ignore */
            }
          }
          // Notify each sender that this user read their messages.
          const bySender = {};
          for (const m of unread) {
            bySender[m.senderId] = (bySender[m.senderId] || 0) + 1;
          }
          for (const [senderId, count] of Object.entries(bySender)) {
            io.to(`user:${senderId}`).emit('chat:group_messages_read', {
              groupId,
              readerId: userId,
              count,
            });
          }
        }
        ack?.({ ok: true, count: unread.length });
      } catch (err) {
        console.error('Socket group_mark_read error:', err);
        ack?.({ ok: false, error: 'Failed to mark group messages as read' });
      }
    });

    socket.on('disconnect', () => {
      socket.leave(`user:${userId}`);
      // Leave any call rooms this socket was in so peers are notified.
      for (const roomId of joinedRooms) {
        signaling.leave(io, roomId, userId, socket.id);
      }
      joinedRooms.clear();
      // Mark offline and persist last seen.
      presence.presence.delete(userId);
      presence.persistLastSeen(userId);
      presence.broadcast(io, userId, 'OFFLINE');
    });
  });

  return io;
}

module.exports = { attachSocketIO, getIO };
