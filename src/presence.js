const prisma = require('./prisma');

// In-memory presence for connected users.
// userId -> { lastActivity: number (ms), inCall: boolean, lastStatus: string }
const presence = new Map();

const AWAY_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes idle => away

function statusOf(userId) {
  const p = presence.get(userId);
  if (!p) return 'OFFLINE';
  if (p.inCall) return 'IN_CALL';
  if (Date.now() - p.lastActivity <= AWAY_THRESHOLD_MS) return 'ONLINE';
  return 'AWAY';
}

function touch(userId) {
  const p = presence.get(userId);
  if (!p) return;
  p.lastActivity = Date.now();
}

function setInCall(userId, inCall) {
  const p = presence.get(userId);
  if (!p) return;
  p.inCall = !!inCall;
  p.lastActivity = Date.now();
}

function isConnected(userId) {
  return presence.has(userId);
}

// Broadcast a presence change to every connected client and remember it.
function broadcast(io, userId, status) {
  const p = presence.get(userId);
  if (p) p.lastStatus = status;
  io.emit('presence:update', { userId, status });
}

// Persist lastSeenAt so offline users keep a meaningful "last seen" value.
async function persistLastSeen(userId) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });
  } catch {
    /* ignore persistence errors */
  }
}

let sweepTimer = null;

// Periodically re-evaluate every connected user's status and broadcast any
// that changed (e.g. ONLINE -> AWAY after 5 idle minutes). Also persists
// lastSeenAt so the value stays fresh.
function startTimers(io) {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    for (const [userId, p] of presence.entries()) {
      const status = statusOf(userId);
      if (status !== p.lastStatus) {
        broadcast(io, userId, status);
      }
      persistLastSeen(userId);
    }
  }, 30 * 1000);
  if (sweepTimer.unref) sweepTimer.unref();
}

module.exports = {
  presence,
  statusOf,
  touch,
  setInCall,
  isConnected,
  broadcast,
  persistLastSeen,
  startTimers,
  AWAY_THRESHOLD_MS,
};
