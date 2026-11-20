const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const router = express.Router();

// ── Knowledge base ──────────────────────────────────────────────────────────
// The app guide is the single source of truth the assistant answers from.
// It is read once and cached in memory.
const GUIDE_PATH = path.join(__dirname, '..', '..', 'resources', 'docs', 'app-guide.md');

let guideCache = null;
function getGuide() {
  if (guideCache === null) {
    try {
      guideCache = fs.readFileSync(GUIDE_PATH, 'utf8');
    } catch (err) {
      console.error('Failed to load app-guide.md:', err.message);
      guideCache = '';
    }
  }
  return guideCache;
}

// ── Role-aware system instruction ───────────────────────────────────────────
// The assistant's scope depends on WHO is asking:
//  - VISITOR (no account): only the public website. Platform features
//    (lessons, calendar, quizzes, video calls, chat, ...) require an account,
//    so the bot steers them to Login or to contacting the school.
//  - STUDENT / TEACHER / ADMIN: full access to the features their role has.

const VISITOR_RESTRICTION =
  '\n\n=== ΠΕΡΙΟΡΙΣΜΟΣ: Ο ΧΡΗΣΤΗΣ ΔΕΝ ΕΙΝΑΙ ΣΥΝΔΕΔΕΜΕΝΟΣ (ΕΠΙΣΚΕΠΤΗΣ) ===\n' +
  'Ο χρήστης είναι απλός επισκέπτης χωρίς λογαριασμό. ' +
  'Μπορείς να απαντήσεις ΜΟΝΟ για τον δημόσιο ιστότοπο: ' +
  'σελίδες Home, About Us, Our Teachers, Our School, The Bilingual Project, Gallery, ' +
  'Reviews, ELT Excellence Awards, και για το πώς γίνεται η εγγραφή (μόνο με πρόσκληση) ' +
  'και η σύνδεση (Login). ' +
  'Αν ρωτήσει για λειτουργίες που απαιτούν λογαριασμό (μαθήματα, ημερολόγιο/πρόγραμμα, ' +
  'κουίζ, διαγωνισμοί, κατάταξη, βιντεοκλήσεις, chat/μηνύματα, διαχείριση μαθητών, ' +
  'προφίλ κ.λπ.), ΜΗΝ δώσεις οδηγίες για αυτές. Αντίθετα, εξήγησε ευγενικά ότι ' +
  'χρειάζεται λογαριασμός και σήκοντάς τον: ' +
  '(1) να κάνει Login από το κουμπί πάνω δεξιά στον ιστότοπο, ή ' +
  '(2) να επικοινωνήσει με τη σχολή (email: realenglished@gmail.com, τηλ: +030 238130 2089).';

const ROLE_NOTES = {
  STUDENT:
    '\n\n=== ΡΟΛΟΣ ΧΡΗΣΤΗ: ΜΑΘΗΤΗΣ (STUDENT) ===\n' +
    'Ο χρήστης είναι συνδεδεμένος μαθητής. Μπορεί να ρωτά για: κουίζ, κατάταξη, ' +
    'διαγωνισμούς, το ημερολόγιό του (My Calendar), βιντεοκλήσεις, chat/μηνύματα, ' +
    'ειδοποιήσεις, προφίλ, και τον δημόσιο ιστότοπο.',
  TEACHER:
    '\n\n=== ΡΟΛΟΣ ΧΡΗΣΤΗ: ΚΑΘΗΓΗΤΗΣ (TEACHER) ===\n' +
    'Ο χρήστης είναι συνδεδεμένος καθηγητής. Μπορεί να ρωτά για: όλα όσα μπορεί ένας ' +
    'μαθητής, συν διαχείριση ημερολογίου (ομάδες & γεγονότα), διαχείριση βιντεοκλήσεων, ' +
    'προσκλήσεις μαθητών (Invites) και διαχείριση μαθητών (Students).',
  ADMIN:
    '\n\n=== ΡΟΛΟΣ ΧΡΗΣΤΗ: ΔΙΑΧΕΙΡΙΣΤΗΣ (ADMIN) ===\n' +
    'Ο χρήστης είναι συνδεδεμένος διαχειριστής. Μπορεί να ρωτά για όλες τις ' +
    'λειτουργίες της πλατφόρμας, συμπεριλαμβανομένης της επεξεργασίας περιεχομένου ' +
    '(Edit Mode) και του πίνακα προσκλήσεων (Invites).',
};

function buildSystemInstruction(role, language) {
  const langRule =
    language === 'en'
      ? 'Απάντα αποκλειστικά στα Αγγλικά (English), ανεξάρτητα από τη γλώσσα της ερώτησης.'
      : language === 'el'
        ? 'Απάντα αποκλειστικά στα Ελληνικά, ανεξάρτητα από τη γλώσσα της ερώτησης.'
        : 'Απάντα στη γλώσσα που ρωτάει ο χρήστης (Ελληνικά ή Αγγλικά).';

  let s =
    'Είσαι ο επίσημος βοηθός υποστήριξης της πλατφόρμας Real English Academy. ' +
    'Απάντα σύντομα, φιλικά και ξεκάθαρα. ' +
    langRule +
    ' Βάσου ΑΠΟΚΛΕΙΣΤΙΚΑ στις παρακάτω οδηγίες της εφαρμογής. ' +
    'Όταν αναφέρεις μια σελίδα, δίνε και το αντίστοιχο path/link σε μορφή Markdown ' +
    '(π.χ. [Σελίδα Μαθημάτων](/students)). ' +
    'Αν ρωτήσουν κάτι εκτός εφαρμογής ή κάτι που δεν αναφέρεται στις οδηγίες, ' +
    'απάντα ευγενικά ότι μπορείς να βοηθήσεις μόνο με τη χρήση της πλατφόρμας.\n\n' +
    '=== ΟΔΗΓΙΕΣ ΕΦΑΡΜΟΓΗΣ / APP GUIDE ===\n' +
    getGuide();

  if (role === 'VISITOR' || !ROLE_NOTES[role]) {
    s += VISITOR_RESTRICTION;
  } else {
    s += ROLE_NOTES[role];
  }
  return s;
}

/**
 * Optional auth: returns the user's role if a valid JWT is present
 * (Authorization header or token cookie), otherwise 'VISITOR'.
 */
function getOptionalRole(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.cookies && req.cookies.token) || null;
  if (!token) return 'VISITOR';
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.role || 'VISITOR';
  } catch {
    return 'VISITOR';
  }
}

// ── Validation & rate limiting ──────────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 20; // keep the context window small
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per IP per window

// Simple in-memory per-IP rate limiter (good enough for a single-instance app).
const rateBuckets = new Map(); // ip -> { count, resetAt }

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many requests. Please wait a minute and try again.',
    });
  }
  next();
}

// Periodically drop stale buckets so the map does not grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// ── AI call (with automatic failover) ───────────────────────────────────────
// The assistant talks to the aiProvider gateway, which tries Gemini first and
// automatically falls back to Groq, then OpenRouter, when a provider's quota
// is exhausted (staying on the fallback until the day rolls over).
const { chatCompletion } = require('../services/aiProvider');

/**
 * Convert our { role, text } history + the new user message into the
 * OpenAI-style messages array used by the aiProvider gateway.
 */
function buildMessages(history, message) {
  const messages = [];
  const safeHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];
  for (const turn of safeHistory) {
    const role = turn && turn.role === 'model' ? 'assistant' : 'user';
    const text = typeof turn.text === 'string' ? turn.text.slice(0, MAX_MESSAGE_LENGTH) : '';
    if (!text.trim()) continue;
    messages.push({ role, content: text });
  }
  messages.push({ role: 'user', content: message });
  return messages;
}

/**
 * Call the AI gateway (Gemini → Groq → OpenRouter) and return the reply text.
 */
async function callAssistantAI(systemInstruction, messages) {
  const text = await chatCompletion({
    system: systemInstruction,
    messages,
    temperature: 0.4,
    maxTokens: 1024,
    timeoutMs: 30000,
  });
  if (!text) throw new Error('AI returned an empty reply');
  return text;
}

// ── Endpoint ────────────────────────────────────────────────────────────────
/**
 * POST /api/assistant/chat
 * Body: {
 *   message: string,
 *   history?: Array<{ role: 'user'|'model', text: string }>,
 *   language?: 'el' | 'en'   // preferred reply language
 * }
 * Returns: { reply: string }
 *
 * Public (no auth required) so visitors without an account can use the
 * assistant. When a valid JWT is present (Authorization header or token
 * cookie) the user's role is used to scope the answers; otherwise the
 * visitor restriction applies.
 */
router.post('/chat', rateLimit, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`,
    });
  }

  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const language = ['el', 'en'].includes(req.body?.language) ? req.body.language : 'auto';
  const role = getOptionalRole(req);

  try {
    const systemInstruction = buildSystemInstruction(role, language);
    const messages = buildMessages(history, message);
    const reply = await callAssistantAI(systemInstruction, messages);
    if (!reply) {
      return res.status(502).json({
        error: 'The assistant could not generate a reply. Please try again.',
      });
    }
    return res.json({ reply });
  } catch (err) {
    console.error('Assistant chat error:', err.message);
    return res.status(502).json({
      error: 'Something went wrong while contacting the assistant. Please try again.',
    });
  }
});

module.exports = router;
