const express = require('express');
const crypto = require('crypto');
const prisma = require('../prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendInviteEmail } = require('../services/email');
const { appBaseUrl } = require('../services/urls');

const router = express.Router();

const TOKEN_TTL_DAYS = 7;

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function inviteUrl(token, req) {
  return `${appBaseUrl(req)}/register?token=${token}`;
}

/**
 * POST /api/invites
 * Admin or Teacher.
 * - Admin can invite TEACHER or STUDENT.
 * - Teacher can invite STUDENT only.
 * Body: { emails: string[], role: 'TEACHER' | 'STUDENT', sendEmail?: boolean }
 * Creates one token per email (or a single generic token when emails is empty).
 * When sendEmail is true, sends the HTML invitation email to each recipient.
 * Response: { invites: [{ token, email, role, url, expiresAt, emailSent, emailError }] }
 */
router.post(
  '/',
  requireAuth,
  requireRole('TEACHER'),
  async (req, res) => {
    try {
      const { emails, role, sendEmail } = req.body || {};
      if (!['TEACHER', 'STUDENT'].includes(role)) {
        return res.status(400).json({ error: "role must be 'TEACHER' or 'STUDENT'" });
      }
      // Teachers may only invite students.
      if (req.user.role !== 'ADMIN' && role !== 'STUDENT') {
        return res.status(403).json({ error: 'Teachers can only invite students' });
      }

      // Accept comma- or line-separated email strings as well as arrays.
      let emailList = [];
      if (Array.isArray(emails)) {
        emailList = emails;
      } else if (typeof emails === 'string') {
        emailList = emails
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
      const invites = [];

      if (emailList.length === 0) {
        // Generic shareable link (no specific email bound).
        const token = generateToken();
        const record = await prisma.inviteToken.create({
          data: { token, email: null, role, expiresAt, createdById: req.user.id },
        });
        invites.push({
          token: record.token,
          email: null,
          role,
          url: inviteUrl(token, req),
          expiresAt: record.expiresAt,
          emailSent: false,
        });
      } else {
        for (const email of emailList) {
          const token = generateToken();
          const record = await prisma.inviteToken.create({
            data: { token, email, role, expiresAt, createdById: req.user.id },
          });
          let emailSent = false;
          let emailError = null;
          if (sendEmail) {
            const outcome = await sendInviteEmail(email, role, inviteUrl(token, req));
            emailSent = outcome.sent;
            emailError = outcome.sent ? null : outcome.reason;
          }
          invites.push({
            token: record.token,
            email,
            role,
            url: inviteUrl(token, req),
            expiresAt: record.expiresAt,
            emailSent,
            emailError,
          });
        }
      }

      res.status(201).json({ invites });
    } catch (err) {
      console.error('Invite create error:', err);
      res.status(500).json({ error: 'Failed to create invites' });
    }
  }
);

/**
 * GET /api/invites
 * Admin or Teacher.
 * - Admin sees ALL email-based invites (shareable links are excluded).
 * - Teacher sees only their own email-based invites.
 */
router.get(
  '/',
  requireAuth,
  requireRole('TEACHER'),
  async (req, res) => {
    try {
      const where = { email: { not: null } };
      if (req.user.role !== 'ADMIN') {
        where.createdById = req.user.id;
      }
      const tokens = await prisma.inviteToken.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json(
        tokens.map((t) => ({
          id: t.id,
          email: t.email,
          role: t.role,
          isUsed: t.isUsed,
          url: inviteUrl(t.token, req),
          expiresAt: t.expiresAt,
          createdAt: t.createdAt,
        }))
      );
    } catch (err) {
      console.error('Invite list error:', err);
      res.status(500).json({ error: 'Failed to list invites' });
    }
  }
);

/**
 * GET /api/invites/validate/:token
 * Public (called by the registration page before rendering the form).
 * Response: { valid: true, role, email } or { valid: false, reason }
 */
router.get('/validate/:token', async (req, res) => {
  try {
    const record = await prisma.inviteToken.findUnique({
      where: { token: req.params.token },
    });

    if (!record) {
      return res.json({ valid: false, reason: 'not_found' });
    }
    if (record.isUsed) {
      return res.json({ valid: false, reason: 'already_used' });
    }
    if (new Date(record.expiresAt) < new Date()) {
      return res.json({ valid: false, reason: 'expired' });
    }

    res.json({ valid: true, role: record.role, email: record.email });
  } catch (err) {
    console.error('Invite validate error:', err);
    res.status(500).json({ error: 'Failed to validate token' });
  }
});

module.exports = router;
