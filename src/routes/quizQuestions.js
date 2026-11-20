const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const LEVEL_TO_CLASS = {
  A1: 'A-Junior',
  A2: 'B-Junior',
  B1: 'A-Senior',
  B2: 'B-Senior',
  C1: 'C-Junior',
  C2: 'C-Senior',
};
const LEVELS = Object.keys(LEVEL_TO_CLASS);
const TYPES = [
  'MULTIPLE_CHOICE',
  'SENTENCE_ORDERING',
  'FILL_IN_THE_BLANK',
  'ERROR_CORRECTION',
  'TRUE_FALSE',
  'SYNONYM_ANTONYM',
];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MODES = ['DAILY', 'WEEKLY', 'TOURNAMENT', 'PRACTICE'];

function parseQuestion(input, createdBy, existing = {}) {
  const questionText = typeof input.questionText === 'string' ? input.questionText.trim() : '';
  const cefrLevel = input.cefrLevel || existing.cefrLevel;
  const difficulty = (input.difficulty || existing.difficulty || '').toLowerCase();
  const questionType = input.questionType || existing.questionType || 'MULTIPLE_CHOICE';
  const options = input.options === undefined ? JSON.parse(existing.options || '[]') : input.options;
  const correctAnswer = input.correctAnswer === undefined ? existing.correctAnswer : input.correctAnswer;
  const correctAnswerText = input.correctAnswerText === undefined
    ? existing.correctAnswerText
    : input.correctAnswerText;
  const questionData = input.questionData === undefined
    ? (existing.questionData ? JSON.parse(existing.questionData) : null)
    : input.questionData;
  const topicSyllabusTag = typeof input.topicSyllabusTag === 'string'
    ? input.topicSyllabusTag.trim()
    : (existing.topicSyllabusTag || 'General');

  if (!questionText || questionText.length > 2000) throw new Error('Question text is required and must be under 2,000 characters');
  if (!LEVELS.includes(cefrLevel)) throw new Error('A valid CEFR level is required');
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('A valid difficulty is required');
  if (!TYPES.includes(questionType)) throw new Error('Invalid question type');
  if (questionData !== null && (typeof questionData !== 'object' || Array.isArray(questionData))) {
    throw new Error('Question data must be a JSON object');
  }

  let finalOptions;
  let finalCorrectAnswer;
  let finalCorrectAnswerText;

  if (questionType === 'TRUE_FALSE') {
    finalOptions = ['True', 'False'];
    if (!Number.isInteger(correctAnswer) || correctAnswer < 0 || correctAnswer > 1) {
      throw new Error('Select the correct answer: True or False');
    }
    finalCorrectAnswer = correctAnswer;
    finalCorrectAnswerText = finalOptions[correctAnswer];
  } else if (questionType === 'SENTENCE_ORDERING') {
    if (!Array.isArray(options) || options.length < 2 || options.length > 15
      || !options.every((token) => typeof token === 'string' && token.trim().length > 0)) {
      throw new Error('Provide between 2 and 15 non-empty tokens');
    }
    finalOptions = options.map((token) => token.trim());
    let order;
    try {
      order = typeof correctAnswerText === 'string' ? JSON.parse(correctAnswerText) : correctAnswerText;
    } catch (err) {
      throw new Error('Sentence ordering answer must be a JSON array');
    }
    if (!Array.isArray(order) || order.length !== finalOptions.length
      || !order.every((token) => typeof token === 'string' && token.trim().length > 0)) {
      throw new Error('The correct order must use every token exactly once');
    }
    const optionTokens = [...finalOptions].sort();
    const answerTokens = order.map((token) => token.trim()).sort();
    if (optionTokens.some((token, index) => token !== answerTokens[index])) {
      throw new Error('The correct order must use every token exactly once');
    }
    finalCorrectAnswer = 0;
    finalCorrectAnswerText = JSON.stringify(order.map((token) => token.trim()));
  } else {
    if (!Array.isArray(options) || options.length < 2 || options.length > 6
      || !options.every((option) => typeof option === 'string' && option.trim().length > 0)) {
      throw new Error('Provide between 2 and 6 non-empty options');
    }
    finalOptions = options.map((option) => option.trim());
    if (!Number.isInteger(correctAnswer) || correctAnswer < 0 || correctAnswer >= finalOptions.length) {
      throw new Error('Select a correct answer from the options');
    }
    finalCorrectAnswer = correctAnswer;
    finalCorrectAnswerText = finalOptions[correctAnswer];

    if (questionType === 'FILL_IN_THE_BLANK') {
      const sentence = questionData && typeof questionData.sentence === 'string' ? questionData.sentence : '';
      const parts = questionData && Array.isArray(questionData.sentenceParts)
        ? questionData.sentenceParts.filter((part) => typeof part === 'string')
        : [];
      if (!sentence.includes('___') && !parts.some((part) => part.includes('___'))) {
        throw new Error('The fill-in-the-blank sentence must contain a ___ blank');
      }
    }
    if (questionType === 'ERROR_CORRECTION') {
      const correction = questionData && typeof questionData.correction === 'string' ? questionData.correction.trim() : '';
      if (!correction) throw new Error('Provide the correction for the error');
    }
    if (questionType === 'SYNONYM_ANTONYM') {
      const targetWord = questionData && typeof questionData.targetWord === 'string' ? questionData.targetWord.trim() : '';
      const mode = questionData && typeof questionData.mode === 'string' ? questionData.mode : '';
      if (!targetWord) throw new Error('Provide the target word');
      if (!['SYNONYM', 'ANTONYM'].includes(mode)) throw new Error('Select synonym or antonym mode');
    }
  }

  const sourceFlag = input.sourceFlag === undefined ? (existing.sourceFlag || null) : input.sourceFlag;
  if (sourceFlag !== null && (typeof sourceFlag !== 'string' || sourceFlag.length > 50)) {
    throw new Error('Source flag must be at most 50 characters');
  }
  if (input.isScannedSource !== undefined && typeof input.isScannedSource !== 'boolean') {
    throw new Error('Scanned source setting must be true or false');
  }

  return {
    level: LEVEL_TO_CLASS[cefrLevel],
    cefrLevel,
    difficulty,
    questionType,
    topicSyllabusTag,
    questionText,
    options: JSON.stringify(finalOptions),
    questionData: questionData === null ? null : JSON.stringify(questionData),
    correctAnswer: finalCorrectAnswer,
    correctAnswerText: finalCorrectAnswerText,
    explanation: typeof input.explanation === 'string' ? input.explanation.trim() || null : (existing.explanation || null),
    sourceFlag: sourceFlag ? sourceFlag.trim() : null,
    isScannedSource: input.isScannedSource === undefined
      ? Boolean(existing.isScannedSource)
      : Boolean(input.isScannedSource),
    status: 'ACTIVE',
    createdBy: existing.createdBy || createdBy,
    points: existing.points || ({ easy: 10, medium: 20, hard: 30 }[difficulty]),
  };
}

function parsePage(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

router.use(requireAuth, requireRole('TEACHER'));

router.get('/configs', async (req, res) => {
  try {
    const saved = await prisma.quizModeConfig.findMany({ where: { mode: { in: MODES } } });
    const byMode = Object.fromEntries(saved.map((config) => [config.mode, config]));
    res.json({
      configs: MODES.map((mode) => {
        const config = byMode[mode];
        return {
          mode,
          onlyScannedQuestions: config?.onlyScannedQuestions || false,
          allowedSourceFlags: config?.allowedSourceFlags ? JSON.parse(config.allowedSourceFlags) : [],
          typeDistribution: config?.typeDistributionJson ? JSON.parse(config.typeDistributionJson) : null,
        };
      }),
    });
  } catch (err) {
    console.error('Quiz mode config fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch quiz mode settings' });
  }
});

router.put('/configs/:mode', async (req, res) => {
  try {
    const { mode } = req.params;
    const { onlyScannedQuestions = false, allowedSourceFlags = [], typeDistribution = null } = req.body || {};
    if (!MODES.includes(mode)) return res.status(400).json({ error: 'Invalid quiz mode' });
    if (typeof onlyScannedQuestions !== 'boolean'
      || !Array.isArray(allowedSourceFlags)
      || !allowedSourceFlags.every((flag) => typeof flag === 'string' && flag.length <= 50)
      || (typeDistribution !== null && (typeof typeDistribution !== 'object' || Array.isArray(typeDistribution)))) {
      return res.status(400).json({ error: 'Invalid quiz mode settings' });
    }

    const config = await prisma.quizModeConfig.upsert({
      where: { mode },
      update: {
        onlyScannedQuestions,
        allowedSourceFlags: JSON.stringify(allowedSourceFlags),
        typeDistributionJson: typeDistribution ? JSON.stringify(typeDistribution) : null,
        updatedAt: new Date(),
      },
      create: {
        mode,
        onlyScannedQuestions,
        allowedSourceFlags: JSON.stringify(allowedSourceFlags),
        typeDistributionJson: typeDistribution ? JSON.stringify(typeDistribution) : null,
        updatedAt: new Date(),
      },
    });
    res.json({
      mode: config.mode,
      onlyScannedQuestions: config.onlyScannedQuestions,
      allowedSourceFlags: JSON.parse(config.allowedSourceFlags || '[]'),
      typeDistribution: config.typeDistributionJson ? JSON.parse(config.typeDistributionJson) : null,
    });
  } catch (err) {
    console.error('Quiz mode config update error:', err);
    res.status(500).json({ error: 'Failed to update quiz mode settings' });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = parsePage(req.query.page, 1, 100000);
    const pageSize = [25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
    const where = { status: 'ACTIVE' };
    if (LEVELS.includes(req.query.level)) where.cefrLevel = req.query.level;
    if (TYPES.includes(req.query.questionType)) where.questionType = req.query.questionType;
    if (DIFFICULTIES.includes(String(req.query.difficulty || '').toLowerCase())) {
      where.difficulty = String(req.query.difficulty).toLowerCase();
    }
    if (req.query.source === 'SCANNED') where.isScannedSource = true;
    else if (typeof req.query.source === 'string' && req.query.source) where.sourceFlag = req.query.source;
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const search = req.query.search.trim().slice(0, 100);
      where.OR = [
        { questionText: { contains: search } },
        { options: { contains: search } },
        { correctAnswerText: { contains: search } },
      ];
    }

    const [questions, total, counts, flags] = await Promise.all([
      prisma.question.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.question.count({ where }),
      prisma.question.groupBy({
        by: ['cefrLevel'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      prisma.question.findMany({
        where: { status: 'ACTIVE', sourceFlag: { not: null } },
        distinct: ['sourceFlag'],
        select: { sourceFlag: true },
      }),
    ]);

    res.json({
      questions: questions.map((question) => ({
        ...question,
        options: JSON.parse(question.options),
        questionData: question.questionData ? JSON.parse(question.questionData) : null,
      })),
      page,
      pageSize,
      total,
      countsByLevel: Object.fromEntries(LEVELS.map((level) => [
        level,
        counts.find((item) => item.cefrLevel === level)?._count._all || 0,
      ])),
      sourceFlags: flags.map((item) => item.sourceFlag).filter(Boolean).sort(),
    });
  } catch (err) {
    console.error('Question bank fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch question bank' });
  }
});

router.post('/bulk-save', async (req, res) => {
  try {
    const questions = req.body?.questions;
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 500) {
      return res.status(400).json({ error: 'Provide between 1 and 500 questions' });
    }
    const data = questions.map((question) => parseQuestion(question, req.user.id));
    const created = await prisma.$transaction(data.map((question) => prisma.question.create({ data: question })));
    res.status(201).json({ saved: created.length, questions: created.map((question) => ({ id: question.id })) });
  } catch (err) {
    if (err.message && /required|valid|Provide|Select|must|characters|options|tokens/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Question bank bulk save error:', err);
    res.status(500).json({ error: 'Failed to save questions' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Question not found' });
    const data = parseQuestion(req.body || {}, req.user.id, existing);
    const question = await prisma.question.update({ where: { id: existing.id }, data });
    res.json({
      ...question,
      options: JSON.parse(question.options),
      questionData: question.questionData ? JSON.parse(question.questionData) : null,
    });
  } catch (err) {
    if (err.message && /required|valid|Provide|Select|must|characters|options|tokens/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Question bank update error:', err);
    res.status(500).json({ error: 'Failed to update question' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Question not found' });
    await prisma.question.delete({ where: { id: existing.id } });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Question bank delete error:', err);
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

module.exports = router;
