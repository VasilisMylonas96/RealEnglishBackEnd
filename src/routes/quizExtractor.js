const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { processExtractionJob } = require('../services/quizExtractor');
const { getUploadsSubDir } = require('../services/uploadsPath');

const router = express.Router();
const prisma = new PrismaClient();

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB max (scanned books)

// Large files go to disk (not RAM) so 1GB uploads don't blow up memory.
const UPLOAD_DIR = getUploadsSubDir('extraction');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only PDF or image files are allowed'), ok);
  },
});

// Clear 413 for oversized uploads instead of a generic 500.
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File is too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
}

// All extractor endpoints require a teacher/admin.
router.use(requireAuth, requireRole('TEACHER'));

/**
 * POST /api/quiz-extractor/upload
 * multipart/form-data: file, mode (WORKSHEET|BOOK), sourceFlag (optional)
 * Creates a job and starts processing in the background. Returns { jobId }.
 */
router.post('/upload', upload.single('file'), handleUploadError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'A file is required' });
    const mode = req.body.mode === 'BOOK' ? 'BOOK' : 'WORKSHEET';
    const sourceFlag = typeof req.body.sourceFlag === 'string' && req.body.sourceFlag.trim()
      ? req.body.sourceFlag.trim().slice(0, 50)
      : null;

    const job = await prisma.quizExtractionJob.create({
      data: {
        mode,
        fileName: req.file.originalname,
        sourceFlag,
        status: 'PENDING',
        createdBy: req.user.id,
      },
    });

    // The file stays on disk only for the duration of the extraction; the
    // service deletes it when the job finishes (or fails).
    processExtractionJob(prisma, job.id, req.file, mode, sourceFlag).catch((err) => {
      console.error('[quiz-extractor] job crashed:', err);
      fs.unlink(req.file.path, () => {});
      prisma.quizExtractionJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: err.message },
      }).catch(() => {});
    });

    res.status(202).json({ jobId: job.id });
  } catch (err) {
    console.error('Quiz extractor upload error:', err);
    res.status(500).json({ error: 'Failed to start extraction' });
  }
});

/**
 * GET /api/quiz-extractor/jobs/:jobId
 * Returns job status + (when COMPLETED) the staged questions.
 */
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const job = await prisma.quizExtractionJob.findUnique({ where: { id: req.params.jobId } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({
      id: job.id,
      mode: job.mode,
      fileName: job.fileName,
      sourceFlag: job.sourceFlag,
      status: job.status,
      totalBatches: job.totalBatches,
      doneBatches: job.doneBatches,
      error: job.error,
      questions: job.status === 'COMPLETED' && job.questionsJson ? JSON.parse(job.questionsJson) : [],
    });
  } catch (err) {
    console.error('Quiz extractor job fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

/**
 * POST /api/quiz-extractor/jobs/:jobId/save
 * Body: { questions: [ ... ] } — the (possibly edited) questions to save.
 * Writes them to the main question bank and marks the job done.
 */
router.post('/jobs/:jobId/save', async (req, res) => {
  try {
    const job = await prisma.quizExtractionJob.findUnique({ where: { id: req.params.jobId } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const questions = req.body?.questions;
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 10000) {
      return res.status(400).json({ error: 'Provide between 1 and 10,000 questions' });
    }

    const LEVEL_TO_CLASS = {
      A1: 'A-Junior', A2: 'B-Junior', B1: 'A-Senior',
      B2: 'B-Senior', C1: 'C-Junior', C2: 'C-Senior',
    };
    const data = questions.map((q) => ({
      level: LEVEL_TO_CLASS[q.cefrLevel] || 'A-Junior',
      cefrLevel: q.cefrLevel,
      difficulty: q.difficulty,
      questionType: q.questionType,
      topicSyllabusTag: q.topicSyllabusTag || 'General',
      questionText: q.questionText,
      options: JSON.stringify(q.options),
      questionData: q.questionData ? JSON.stringify(q.questionData) : null,
      correctAnswer: q.correctAnswer,
      correctAnswerText: q.correctAnswerText,
      explanation: q.explanation || null,
      sourceFlag: q.sourceFlag || job.sourceFlag,
      isScannedSource: true,
      status: 'ACTIVE',
      createdBy: req.user.id,
      points: ({ easy: 10, medium: 20, hard: 30 })[q.difficulty] || 10,
    }));

    const result = await prisma.question.createMany({ data });
    await prisma.quizExtractionJob.update({
      where: { id: job.id },
      data: { questionsJson: null },
    });
    res.status(201).json({ saved: result.count });
  } catch (err) {
    console.error('Quiz extractor save error:', err);
    res.status(500).json({ error: 'Failed to save questions' });
  }
});

module.exports = router;
