require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const contentRoutes = require('./routes/content');
const mediaRoutes = require('./routes/media');
const reviewsRoutes = require('./routes/reviews');
const contactRoutes = require('./routes/contact');
const invitesRoutes = require('./routes/invites');
const quizRoutes = require('./routes/quizzes');
const quizQuestionRoutes = require('./routes/quizQuestions');
const quizExtractorRoutes = require('./routes/quizExtractor');
const leaderboardRoutes = require('./routes/leaderboard');
const studentRoutes = require('./routes/students');
const tournamentRoutes = require('./routes/tournaments');
const calendarRoutes = require('./routes/calendar');
const videoCallRoutes = require('./routes/videoCalls');
const notificationRoutes = require('./routes/notifications');
const chatRoutes = require('./routes/chat');
const assistantRoutes = require('./routes/assistant');
const announcementRoutes = require('./routes/announcements');
const { startInstagramSyncScheduler } = announcementRoutes;
const { attachSocketIO } = require('./socket');
const { maybeRunAnnualResetOnStartup } = require('./services/annualReset');
const { startBirthdayScheduler } = require('./services/birthdays');
const { startQuizEmailScheduler } = require('./services/quizEmails');
const { getUploadsDir } = require('./services/uploadsPath');

const app = express();

const PORT = process.env.PORT || 4000;
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true, // allow HTTP-only cookie + Authorization header
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Static uploads: permanent, fast, link-based media delivery.
// The directory is configurable via UPLOADS_DIR (defaults to <project>/uploads).
app.use('/uploads', express.static(getUploadsDir(), {
  maxAge: '30d',
  immutable: true,
}));

// Static brand assets (logos used in outbound email templates).
app.use('/brand', express.static(path.join(__dirname, '..', 'brand'), {
  maxAge: '30d',
  immutable: true,
}));

// Health check. Lightweight and dependency-free so it answers instantly even
// while the app is warming up on a free host (Render/Railway) — useful for
// uptime monitors and for the frontend to detect a cold start.
app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    service: 'realenglish-backend',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  })
);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/invites', invitesRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/quiz-questions', quizQuestionRoutes);
app.use('/api/quiz-extractor', quizExtractorRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/video-calls', videoCallRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/announcements', announcementRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler (multer errors, JSON parse errors, etc.)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Real English backend listening on http://localhost:${PORT}`);

  // Real-time chat (Socket.io) attached to the same HTTP server.
  attachSocketIO(server, allowedOrigins);

  // Annual reset (Sep 23): archive champions + zero out points. Idempotent.
  maybeRunAnnualResetOnStartup().catch((err) => {
    console.error('Annual reset check failed:', err.message);
  });

  // Birthday notifications: check on boot + every 30 minutes.
  startBirthdayScheduler();

  // Instagram announcement sync: first run 2 min after boot, then hourly.
  startInstagramSyncScheduler();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the process using it or configure a different PORT.`
    );
  } else {
    console.error('Failed to start the backend:', err);
  }
  process.exit(1);
});
