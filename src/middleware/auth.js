const jwt = require('jsonwebtoken');

/**
 * JWT authentication middleware.
 * Accepts the token via the `Authorization: Bearer <token>` header
 * or the `token` cookie (HTTP-only cookie flow).
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.cookies && req.cookies.token) || null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, role: payload.role, username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Role-based access control.
 * Roles are hierarchical: ADMIN (1) > TEACHER (2) > STUDENT (3).
 * `minRole` is the highest level allowed; callers with an equal or
 * lower-numbered (more privileged) role pass through.
 */
const ROLE_LEVEL = { ADMIN: 1, TEACHER: 2, STUDENT: 3 };

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userLevel = ROLE_LEVEL[req.user.role] || 99;
    const requiredLevel = ROLE_LEVEL[minRole] || 99;
    if (userLevel > requiredLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, ROLE_LEVEL };
