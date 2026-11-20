const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { selectBalancedQuizQuestions } = require('../services/balancedQuizQuestions');
const { parseQuestionData, isQuestionAnswerCorrect } = require('../services/questionAnswers');

const router = express.Router();
const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ADMIN_QUIZ_LEVEL = 'C-Senior';

// Points per difficulty
const POINTS = { easy: 10, medium: 20, hard: 30 };

// Daily quiz structure: 5 easy, 3 medium, 2 hard
const DAILY_STRUCTURE = [
  { difficulty: 'easy', count: 5 },
  { difficulty: 'medium', count: 3 },
  { difficulty: 'hard', count: 2 },
];

// Weekly quiz: progressive difficulty, max +3 level variance
const WEEKLY_STRUCTURE = [
  { difficulty: 'easy', count: 4 },
  { difficulty: 'medium', count: 4 },
  { difficulty: 'hard', count: 4 },
];

function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();
  // Academic year starts Sep 11
  if (month > 9 || (month === 9 && day >= 11)) {
    return `${date.getFullYear()}-${date.getFullYear() + 1}`;
  }
  return `${date.getFullYear() - 1}-${date.getFullYear()}`;
}

function isFriday(date = new Date()) {
  return date.getDay() === 5;
}

function getTodayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getWeekKey(date = new Date()) {
  // Monday of the current week
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

// ─── GET /api/quizzes/available ─────────────────────────────────────────────
// Returns which quizzes are available for the student today.
router.get('/available', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const quizLevel = user.role === 'ADMIN' ? ADMIN_QUIZ_LEVEL : user.level;

    const today = new Date();
    const todayKey = getTodayKey(today);
    const weekKey = getWeekKey(today);

    // Check if daily quiz already completed today
    const dailyDone = await prisma.quizAttempt.findFirst({
      where: {
        userId: req.user.id,
        quizType: 'DAILY',
        completedAt: { gte: new Date(todayKey + 'T00:00:00') },
      },
    });

    // Check if weekly quiz already completed this week
    const weekStart = new Date(weekKey + 'T00:00:00');
    const weekEnd = new Date(weekKey + 'T00:00:00');
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weeklyDone = await prisma.quizAttempt.findFirst({
      where: {
        userId: req.user.id,
        quizType: 'WEEKLY',
        completedAt: { gte: weekStart, lt: weekEnd },
      },
    });

    res.json({
      daily: {
        available: !dailyDone,
        structure: DAILY_STRUCTURE,
        totalQuestions: 10,
      },
      weekly: {
        available: !weeklyDone && isFriday(today),
        isFriday: isFriday(today),
        structure: WEEKLY_STRUCTURE,
        totalQuestions: 12,
      },
      level: quizLevel,
      academicYear: getAcademicYear(today),
    });
  } catch (err) {
    console.error('Quiz available error:', err);
    res.status(500).json({ error: 'Failed to check quiz availability' });
  }
});

// ─── GET /api/quizzes/start/:type ───────────────────────────────────────────
// Returns a set of questions for the student to answer.
// type: DAILY | WEEKLY
router.get('/start/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;
    if (!['DAILY', 'WEEKLY'].includes(type)) {
      return res.status(400).json({ error: 'Invalid quiz type' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const quizLevel = user.role === 'ADMIN' ? ADMIN_QUIZ_LEVEL : user.level;
    if (!quizLevel) {
      return res.status(400).json({ error: 'No level assigned' });
    }

    const today = new Date();
    const todayKey = getTodayKey(today);
    const weekKey = getWeekKey(today);

    // Prevent duplicate daily
    if (type === 'DAILY') {
      const existing = await prisma.quizAttempt.findFirst({
        where: {
          userId: req.user.id,
          quizType: 'DAILY',
          completedAt: { gte: new Date(todayKey + 'T00:00:00') },
        },
      });
      if (existing) {
        return res.status(409).json({ error: 'Daily quiz already completed today' });
      }
    }

    // Prevent duplicate weekly
    if (type === 'WEEKLY') {
      if (!isFriday(today)) {
        return res.status(400).json({ error: 'Weekly quiz is only available on Fridays' });
      }
      const weekStart = new Date(weekKey + 'T00:00:00');
      const weekEnd = new Date(weekKey + 'T00:00:00');
      weekEnd.setDate(weekEnd.getDate() + 7);
      const existing = await prisma.quizAttempt.findFirst({
        where: {
          userId: req.user.id,
          quizType: 'WEEKLY',
          completedAt: { gte: weekStart, lt: weekEnd },
        },
      });
      if (existing) {
        return res.status(409).json({ error: 'Weekly quiz already completed this week' });
      }
    }

    const structure = type === 'DAILY' ? DAILY_STRUCTURE : WEEKLY_STRUCTURE;

    // Keep the existing level and difficulty structure while balancing types
    // and excluding questions answered correctly in the previous 30 days.
    const questions = await selectBalancedQuizQuestions(prisma, {
      userId: req.user.id,
      level: quizLevel,
      mode: type,
      structure,
    });

    const requiredQuestions = structure.reduce((sum, item) => sum + item.count, 0);
    if (questions.length < requiredQuestions) {
      return res.status(409).json({
        error: `Not enough eligible questions: required ${requiredQuestions}, found ${questions.length}`,
      });
    }

    // Strip sensitive fields
    const sanitized = questions.map((q) => ({
      id: q.id,
      level: q.level,
      cefrLevel: q.cefrLevel,
      difficulty: q.difficulty,
      questionType: q.questionType || 'MULTIPLE_CHOICE',
      topicSyllabusTag: q.topicSyllabusTag,
      questionText: q.questionText,
      options: JSON.parse(q.options),
      questionData: parseQuestionData(q),
      points: q.points,
    }));

    res.json({
      quizType: type,
      level: quizLevel,
      questions: sanitized,
      totalQuestions: sanitized.length,
      startedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Quiz start error:', err);
    res.status(500).json({ error: 'Failed to start quiz' });
  }
});

// ─── POST /api/quizzes/submit ───────────────────────────────────────────────
// Submit quiz answers and get score.
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { quizType, answers, startedAt, durationSec } = req.body || {};
    if (!quizType || !Array.isArray(answers) || !startedAt) {
      return res.status(400).json({ error: 'quizType, answers[], and startedAt are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const quizLevel = user.role === 'ADMIN' ? ADMIN_QUIZ_LEVEL : user.level;

    // Fetch the actual questions to verify answers
    const questionIds = answers.map((a) => a.questionId);
    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds } },
    });
    const qMap = Object.fromEntries(questions.map((q) => [q.id, q]));

    let score = 0;
    let correctCount = 0;
    const answerDetails = [];

    for (const ans of answers) {
      const q = qMap[ans.questionId];
      if (!q) continue;
      const isCorrect = isQuestionAnswerCorrect(q, ans.selectedAnswer);
      const points = isCorrect ? q.points : 0;
      if (isCorrect) correctCount++;
      score += points;
      answerDetails.push({
        questionId: q.id,
        selectedAnswer: ans.selectedAnswer,
        correct: isCorrect,
        points,
      });
    }

    const completedAt = new Date();

    // Save the attempt
    const attempt = await prisma.quizAttempt.create({
      data: {
        userId: req.user.id,
        quizType,
        level: quizLevel,
        totalQuestions: answers.length,
        correctCount,
        score,
        durationSec: durationSec || null,
        answers: JSON.stringify(answerDetails),
        startedAt: new Date(startedAt),
        completedAt,
      },
    });

    // Update leaderboard
    const academicYear = getAcademicYear(completedAt);
    const pointsField = quizType === 'DAILY' ? 'dailyPoints' : 'weeklyPoints';

    await prisma.leaderboardEntry.upsert({
      where: { userId_academicYear: { userId: req.user.id, academicYear } },
      update: {
        [pointsField]: { increment: score },
        totalPoints: { increment: score },
      },
      create: {
        userId: req.user.id,
        academicYear,
        totalPoints: score,
        [pointsField]: score,
      },
    });

    res.json({
      attemptId: attempt.id,
      score,
      correctCount,
      totalQuestions: answers.length,
      accuracy: Math.round((correctCount / answers.length) * 100),
      pointsEarned: score,
      academicYear,
    });
  } catch (err) {
    console.error('Quiz submit error:', err);
    res.status(500).json({ error: 'Failed to submit quiz' });
  }
});

// ─── GET /api/quizzes/history ───────────────────────────────────────────────
// Get the student's quiz history (most recent first).
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const attempts = await prisma.quizAttempt.findMany({
      where: { userId: req.user.id },
      orderBy: { completedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });

    // Get total points
    const academicYear = getAcademicYear();
    const lb = await prisma.leaderboardEntry.findUnique({
      where: { userId_academicYear: { userId: req.user.id, academicYear } },
    });

    res.json({
      attempts: attempts.map((a) => ({
        id: a.id,
        quizType: a.quizType,
        level: a.level,
        totalQuestions: a.totalQuestions,
        correctCount: a.correctCount,
        score: a.score,
        durationSec: a.durationSec,
        completedAt: a.completedAt,
      })),
      totalPoints: lb?.totalPoints || 0,
      academicYear,
    });
  } catch (err) {
    console.error('Quiz history error:', err);
    res.status(500).json({ error: 'Failed to fetch quiz history' });
  }
});

// ─── GET /api/quizzes/history/:attemptId/review ─────────────────────────────
// Get full review data for a completed quiz (read-only).
router.get('/history/:attemptId/review', requireAuth, async (req, res) => {
  try {
    const attempt = await prisma.quizAttempt.findUnique({
      where: { id: req.params.attemptId },
    });
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    // Only the owner or a teacher/admin can view
    if (attempt.userId !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'TEACHER') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const answers = JSON.parse(attempt.answers);
    const questionIds = answers.map((a) => a.questionId);
    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds } },
    });
    const qMap = Object.fromEntries(questions.map((q) => [q.id, q]));

    const review = answers.map((a) => {
      const q = qMap[a.questionId];
      return {
        questionId: q.id,
        questionText: q.questionText,
        options: JSON.parse(q.options),
        questionType: q.questionType || 'MULTIPLE_CHOICE',
        correctAnswer: q.correctAnswer,
        correctAnswerText: q.correctAnswerText,
        questionData: parseQuestionData(q, true),
        selectedAnswer: a.selectedAnswer,
        isCorrect: a.correct,
        points: a.points,
        explanation: q.explanation,
        difficulty: q.difficulty,
        topicSyllabusTag: q.topicSyllabusTag,
      };
    });

    res.json({
      attemptId: attempt.id,
      quizType: attempt.quizType,
      level: attempt.level,
      score: attempt.score,
      correctCount: attempt.correctCount,
      totalQuestions: attempt.totalQuestions,
      completedAt: attempt.completedAt,
      durationSec: attempt.durationSec,
      review,
    });
  } catch (err) {
    console.error('Quiz review error:', err);
    res.status(500).json({ error: 'Failed to fetch review' });
  }
});

module.exports = router;
