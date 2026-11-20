/**
 * Lightweight in-memory WebRTC signaling rooms.
 *
 * The backend only exchanges signaling messages (SDP offers/answers and ICE
 * candidates) between peers in the same room. No media ever touches the
 * server — the actual audio/video flows peer-to-peer over WebRTC, which is
 * what makes this free and unlimited-duration.
 *
 * A "room" is identified by the stable per-event room id (the
 * `jitsiRoomId` column, kept for backward compatibility). Membership is
 * keyed by userId so a participant who refreshes the page is treated as the
 * same peer: their old socket drops (peers get `rtc:peer-left`) and their
 * new socket rejoins (peers get `rtc:peer-joined`), letting the WebRTC layer
 * re-negotiate cleanly.
 *
 * In-memory only: if the server restarts, in-flight calls must re-join. That
 * is acceptable for short tutoring sessions and keeps the backend stateless
 * and trivially deployable on free hosts (Render/Railway).
 */

// roomId -> Map<userId, { displayName, isHost, sockets: Set<socketId> }>
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

/** Snapshot of the current peers in a room (for the joiner's ack). */
function peersOf(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.entries()].map(([userId, p]) => ({
    userId,
    displayName: p.displayName,
    isHost: p.isHost,
  }));
}

/**
 * Add a socket to a room. Returns the full peer list (including the joiner)
 * so the client knows who is already present and can initiate connections.
 */
function join(io, roomId, userId, { displayName, isHost, socketId }) {
  const room = getRoom(roomId);
  let peer = room.get(userId);
  const isNew = !peer;
  if (isNew) {
    peer = { displayName: displayName || '', isHost: !!isHost, sockets: new Set() };
    room.set(userId, peer);
  } else {
    // Rejoin (e.g. after a refresh): refresh display info.
    if (displayName) peer.displayName = displayName;
    peer.isHost = peer.isHost || !!isHost;
  }
  peer.sockets.add(socketId);

  // Tell the other peers that someone joined (the joiner learns about them
  // from the ack instead, so we skip broadcasting to the joiner's sockets).
  if (isNew) {
    for (const [otherId, other] of room.entries()) {
      if (otherId === userId) continue;
      for (const sid of other.sockets) {
        io.to(sid).emit('rtc:peer-joined', {
          roomId,
          userId,
          displayName: peer.displayName,
          isHost: peer.isHost,
        });
      }
    }
  }

  return peersOf(roomId);
}

/**
 * Remove a socket from a room. When the last socket of a user leaves, the
 * user is removed and the remaining peers are notified.
 */
function leave(io, roomId, userId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const peer = room.get(userId);
  if (!peer) return;

  peer.sockets.delete(socketId);
  if (peer.sockets.size === 0) {
    room.delete(userId);
    for (const [otherId, other] of room.entries()) {
      for (const sid of other.sockets) {
        io.to(sid).emit('rtc:peer-left', { roomId, userId });
      }
    }
  }

  // Drop the room entirely once empty to avoid unbounded growth.
  if (room.size === 0) rooms.delete(roomId);
}

/**
 * Relay a signaling message (SDP/ICE) from one peer to another in the same
 * room. The server does not inspect the payload.
 */
function relay(io, roomId, fromUserId, toUserId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  const target = room.get(toUserId);
  if (!target) return;
  for (const sid of target.sockets) {
    io.to(sid).emit('rtc:signal', { roomId, from: fromUserId, data });
  }
}

module.exports = { join, leave, relay, peersOf };
