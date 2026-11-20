const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { publicBaseUrl } = require('../services/urls');
const { sendWelcomeEmail } = require('../services/email');
const { getUploadsDir } = require('../services/uploadsPath');

const router = express.Router();

const UPLOADS_DIR = getUploadsDir();

const VALID_LEVELS = ['A-Junior', 'B-Junior', 'A-Senior', 'B-Senior', 'C-Junior', 'C-Senior'];
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{5,29}$/;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function emailIsInUse(email, excludedUserId) {
  if (!email) return false;
  const users = await prisma.user.findMany({
    where: { email: { not: null } },
    select: { id: true, email: true },
  });
  return users.some(
    (user) =>
      user.id !== excludedUserId &&
      normalizeEmail(user.email) === email
  );
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB max
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { token, user: { id, username, role } }
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '3h' }
    );

    // Also set an HTTP-only cookie so the SPA can rely on cookie auth.
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3 * 60 * 60 * 1000,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        birthDate: user.birthDate,
        email: user.email,
        phone: user.phone,
        level: user.level,
        avatarUrl: user.avatarUrl,
        mustChangePassword: !!user.mustChangePassword,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/refresh
 * Authenticated. Issues a fresh JWT for the current user (used to keep the
 * session alive during long video calls without logging the user out).
 * Returns: { token, user }
 */
router.post('/refresh', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '3h' }
    );
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3 * 60 * 60 * 1000,
    });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        birthDate: user.birthDate,
        email: user.email,
        phone: user.phone,
        level: user.level,
        avatarUrl: user.avatarUrl,
        mustChangePassword: !!user.mustChangePassword,
      },
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

/**
 * POST /api/auth/register
 * Public, but requires a valid single-use invite token.
 * Accepts multipart/form-data with fields:
 *   token, firstName, lastName?, username, email?, phone?, password, avatarUrl? (DiceBear URL)
 *   file? (optional photo upload — takes precedence over avatarUrl)
 * The role is taken from the invite token (TEACHER | STUDENT).
 * On success: marks the token as used, creates the user, returns { token, user }.
 */
router.post('/register', avatarUpload.single('file'), async (req, res) => {
  try {
    const { token, firstName, lastName, birthDate, username, email, phone, password, avatarUrl, level } = req.body || {};

    if (!token || !firstName || !username || !password) {
      return res.status(400).json({
        error: 'token, firstName, username and password are required',
      });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const normalizedPhone = String(phone || '').trim();
    if (normalizedPhone && !PHONE_RE.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Please enter a valid phone number' });
    }

    // Validate the invite token.
    const invite = await prisma.inviteToken.findUnique({ where: { token } });
    if (!invite) {
      return res.status(400).json({ error: 'Invalid invitation token' });
    }
    if (invite.isUsed) {
      return res.status(400).json({ error: 'This invitation has already been used' });
    }
    if (new Date(invite.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'This invitation has expired' });
    }

    // Level is mandatory for students (used by the quiz engine).
    if (invite.role === 'STUDENT') {
      if (!level || !VALID_LEVELS.includes(level)) {
        return res.status(400).json({
          error: `Level is required. Must be one of: ${VALID_LEVELS.join(', ')}`,
        });
      }
    }

    // Uniqueness checks.
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(409).json({ error: 'Username is already taken' });
    }
    const submittedEmail = normalizeEmail(email);
    const invitedEmail = normalizeEmail(invite.email);
    if (submittedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (invitedEmail && submittedEmail && submittedEmail !== invitedEmail) {
      return res.status(400).json({ error: 'The email must match the invitation address' });
    }
    const userEmail = invitedEmail || submittedEmail || null;
    if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (userEmail && await emailIsInUse(userEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Resolve the avatar: uploaded photo takes precedence over a DiceBear URL.
    let finalAvatarUrl = avatarUrl || null;
    if (req.file) {
      const filename = `avatar-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
      const target = path.join(UPLOADS_DIR, filename);
      await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 512, height: 512, fit: 'cover' })
        .webp({ quality: 85 })
        .toFile(target);
      finalAvatarUrl = `${publicBaseUrl(req)}/uploads/${filename}`;
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        firstName,
        lastName: lastName || null,
        birthDate: birthDate ? new Date(birthDate) : null,
        username,
        email: userEmail,
        phone: normalizedPhone || null,
        password: hash,
        role: invite.role,
        level: invite.role === 'STUDENT' ? level : null,
        avatarUrl: finalAvatarUrl,
      },
    });

    // Mark the token as redeemed (single-use).
    await prisma.inviteToken.update({
      where: { id: invite.id },
      data: { isUsed: true, usedById: user.id },
    });

    // Welcome email (fire-and-forget; skipped when the user has no email).
    if (user.email) {
      sendWelcomeEmail(user.email, user).catch((err) => {
        console.error('Welcome email error:', err.message);
      });
    }

    const jwtToken = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '3h' }
    );

    res.cookie('token', jwtToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3 * 60 * 60 * 1000,
    });

    res.status(201).json({
      token: jwtToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        birthDate: user.birthDate,
        email: user.email,
        phone: user.phone,
        level: user.level,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target)
        ? err.meta.target.join(' ')
        : String(err.meta?.target || '');
      if (target.toLowerCase().includes('email')) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      if (target.toLowerCase().includes('username')) {
        return res.status(409).json({ error: 'Username is already taken' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/avatar
 * Authenticated. Uploads a new profile photo and updates the user's avatarUrl.
 * multipart/form-data with field `file`.
 * Response: { avatarUrl }
 */
router.post('/avatar', requireAuth, avatarUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided (field name: file)' });
    }
    const filename = `avatar-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
    const target = path.join(UPLOADS_DIR, filename);
    await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: 'cover' })
      .webp({ quality: 85 })
      .toFile(target);

    const avatarUrl = `${publicBaseUrl(req)}/uploads/${filename}`;
    await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
    });

    res.json({ avatarUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Avatar upload failed' });
  }
});

/**
 * PUT /api/auth/profile
 * Authenticated. Updates editable profile fields: firstName, lastName, birthDate, email, phone, avatarUrl.
 * The username is strictly locked and cannot be changed here.
 * Body: { firstName?, lastName?, birthDate?, email?, phone?, avatarUrl? }
 * Response: { user }
 */
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, birthDate, avatarUrl, email, phone } = req.body || {};
    const data = {};
    if (firstName !== undefined) data.firstName = String(firstName).trim() || null;
    if (lastName !== undefined) data.lastName = String(lastName).trim() || null;
    if (birthDate !== undefined) {
      data.birthDate = birthDate ? new Date(birthDate) : null;
    }
    if (avatarUrl !== undefined) data.avatarUrl = String(avatarUrl).trim() || null;
    if (phone !== undefined) {
      const normalizedPhone = String(phone).trim();
      if (normalizedPhone && !PHONE_RE.test(normalizedPhone)) {
        return res.status(400).json({ error: 'Please enter a valid phone number' });
      }
      data.phone = normalizedPhone || null;
    }
    if (email !== undefined) {
      const normalized = normalizeEmail(email);
      if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }
      // Uniqueness check (email is @unique in the schema).
      if (normalized) {
        if (await emailIsInUse(normalized, req.user.id)) {
          return res.status(409).json({ error: 'This email is already in use by another account' });
        }
      }
      data.email = normalized || null;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        email: true,
        phone: true,
        level: true,
        avatarUrl: true,
      },
    });

    res.json({ user });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * PUT /api/auth/password
 * Authenticated. Changes the user's password.
 * Body: { currentPassword, newPassword }
 * Response: { ok: true }
 */
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword) {
      return res.status(400).json({ error: 'newPassword is required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Forced-change flow: when mustChangePassword is set (after a teacher
    // reset), the user does NOT need to know the old (temporary) password.
    // Otherwise the current password must be verified.
    if (!user.mustChangePassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'currentPassword is required' });
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hash, mustChangePassword: false },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/**
 * POST /api/auth/logout
 * Clears the HTTP-only cookie.
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user (from token), with full profile.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        role: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        email: true,
        phone: true,
        level: true,
        avatarUrl: true,
        mustChangePassword: true,
      },
    });
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }
    res.json({ user });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
