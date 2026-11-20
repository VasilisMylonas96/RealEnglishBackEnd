const express = require('express');
const {
  sendContactNotificationEmail,
  sendContactConfirmationEmail,
} = require('../services/email');

const router = express.Router();

// ─── Basic in-memory rate limiting (per IP) ──────────────────────────────────
// Max 5 submissions per 10 minutes per IP. Good enough for a public contact
// form on a single-instance deployment; no external dependencies needed.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateHits = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateHits) {
    if (now >= entry.resetAt) rateHits.delete(key);
  }
}, 60 * 60 * 1000).unref();

function isRateLimited(ip) {
  const now = Date.now();
  let entry = rateHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateHits.set(ip, entry);
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// ─── Validation helpers ──────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{5,19}$/;

/**
 * Normalizes a user-supplied string: trims, collapses whitespace and strips
 * control characters. HTML escaping happens in the email service (esc()) so
 * the values are safe to embed in the HTML email template; the plain-text
 * fallback is inherently safe.
 */
function clean(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * POST /api/contact
 * Public (unauthenticated). Submits the contact form.
 * Body: { firstName, lastName?, email, phone, subject, message }
 * Sends two emails: a notification to the school inbox (with replyTo set to
 * the visitor's email) and a confirmation back to the visitor.
 */
router.post('/', (req, res) => {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (isRateLimited(ip)) {
    return res
      .status(429)
      .json({ error: 'Too many messages from your connection. Please try again later.' });
  }

  const body = req.body || {};
  const firstName = clean(body.firstName, 100);
  const lastName = clean(body.lastName, 100);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 30);
  const subject = clean(body.subject, 200);
  const message = clean(body.message, 5000);

  const invalid = [];
  if (!firstName) invalid.push('firstName');
  if (!EMAIL_RE.test(email)) invalid.push('email');
  if (!PHONE_RE.test(phone)) invalid.push('phone');
  if (!subject) invalid.push('subject');
  if (!message) invalid.push('message');
  if (invalid.length) {
    return res
      .status(400)
      .json({ error: 'Please fill in all required fields with valid values.', fields: invalid });
  }

  (async () => {
    const [toStaff, toUser] = await Promise.all([
      sendContactNotificationEmail({ firstName, lastName, email, phone, subject, message }),
      sendContactConfirmationEmail({ firstName, lastName, email, phone, subject, message }),
    ]);

    if (!toStaff.sent && !toUser.sent) {
      console.error('[contact] Both emails failed:', toStaff.reason, toUser.reason);
      return res
        .status(502)
        .json({ error: 'Your message could not be sent. Please try again later or email us directly.' });
    }

    res.status(200).json({ ok: true });
  })().catch((err) => {
    console.error('Contact submission error:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  });
});

module.exports = router;
