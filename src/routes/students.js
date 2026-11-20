const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const VALID_LEVELS = ['A-Junior', 'B-Junior', 'A-Senior', 'B-Senior', 'C-Junior', 'C-Senior'];

// The temporary password used when a teacher/admin resets a student's password.
// The student is forced to change it on next login (mustChangePassword = true).
const RESET_PASSWORD = 'password123';

// ─── GET /api/students ──────────────────────────────────────────────────────
// Teacher/Admin: search students by first/last name.
router.get('/', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const { search = '', level = '' } = req.query;

    const where = { role: 'STUDENT' };
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { username: { contains: search } },
      ];
    }
    if (level) {
      where.level = level;
    }

    const students = await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        username: true,
        level: true,
        avatarUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ students });
  } catch (err) {
    console.error('Student list error:', err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// ─── GET /api/students/:id ──────────────────────────────────────────────────
// Teacher/Admin: view a student's profile + quiz history summary.
router.get('/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const student = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        role: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        username: true,
        level: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Quiz summary
    const attempts = await prisma.quizAttempt.findMany({
      where: { userId: student.id },
      orderBy: { completedAt: 'desc' },
      take: 20,
    });

    const academicYear = (() => {
      const d = new Date();
      const m = d.getMonth() + 1;
      const day = d.getDate();
      if (m > 9 || (m === 9 && day >= 11)) return `${d.getFullYear()}-${d.getFullYear() + 1}`;
      return `${d.getFullYear() - 1}-${d.getFullYear()}`;
    })();

    const lb = await prisma.leaderboardEntry.findUnique({
      where: { userId_academicYear: { userId: student.id, academicYear } },
    });

    res.json({
      student,
      totalPoints: lb?.totalPoints || 0,
      dailyPoints: lb?.dailyPoints || 0,
      weeklyPoints: lb?.weeklyPoints || 0,
      recentAttempts: attempts.map((a) => ({
        id: a.id,
        quizType: a.quizType,
        score: a.score,
        correctCount: a.correctCount,
        totalQuestions: a.totalQuestions,
        completedAt: a.completedAt,
      })),
    });
  } catch (err) {
    console.error('Student detail error:', err);
    res.status(500).json({ error: 'Failed to fetch student' });
  }
});

// ─── PUT /api/students/:id/level ────────────────────────────────────────────
// Teacher/Admin: update a student's level.
router.put('/:id/level', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const { level } = req.body || {};
    if (!level || !VALID_LEVELS.includes(level)) {
      return res.status(400).json({ error: `Invalid level. Must be one of: ${VALID_LEVELS.join(', ')}` });
    }

    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ error: 'Student not found' });
    }

    await prisma.user.update({
      where: { id: student.id },
      data: { level },
    });

    res.json({ ok: true, level });
  } catch (err) {
    console.error('Student level update error:', err);
    res.status(500).json({ error: 'Failed to update level' });
  }
});

// ─── POST /api/students/:id/reset-password ──────────────────────────────────
// Teacher/Admin: reset a student's password to the temporary default
// ("password123") and force them to change it on next login.
router.post('/:id/reset-password', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ error: 'Student not found' });
    }

    const hash = await bcrypt.hash(RESET_PASSWORD, 10);
    await prisma.user.update({
      where: { id: student.id },
      data: { password: hash, mustChangePassword: true },
    });

    res.json({ ok: true, temporaryPassword: RESET_PASSWORD });
  } catch (err) {
    console.error('Student reset-password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ─── POST /api/students/:id/set-password ────────────────────────────────────
// Teacher/Admin: directly set a student's password (no old password needed).
// Used when a student has forgotten their password. The student is NOT forced
// to change it (they already have the new one).
router.post('/:id/set-password', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ error: 'Student not found' });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({
      where: { id: student.id },
      data: { password: hash, mustChangePassword: false },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Student set-password error:', err);
    res.status(500).json({ error: 'Failed to set password' });
  }
});

module.exports = router;
