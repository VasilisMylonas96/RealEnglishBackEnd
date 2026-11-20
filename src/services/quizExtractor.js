/**
 * QuizExtractionService — AI OCR & deep book extraction.
 *
 * Takes an uploaded file (scanned worksheet images, a PDF, or a whole scanned
 * book) and uses Gemini (multimodal) to extract as many quiz questions as
 * possible across every supported question type. Results are staged on the
 * job (NOT written to the bank) so the teacher can preview, edit and approve
 * them before saving.
 *
 * Two modes:
 *   WORKSHEET — a handful of pages/images with ready-made exercises.
 *   BOOK      — a long document; chunked into batches for deep extraction.
 *
 * Strategy:
 *   - PDFs: try text extraction first (pdf-parse). If the PDF has real text,
 *     send text chunks (cheap + reliable). If it's a scanned/image PDF, split
 *     it into small page chunks (pdf-lib, no rendering) and send each chunk
 *     to Gemini as a document.
 *   - Image uploads: sent directly as vision input.
 */
const fs = require('fs');

const { chatCompletion, geminiFileCompletion, getGeminiKey } = require('./aiProvider');

const GEMINI_TIMEOUT_MS = 180000; // long: book batches can be large
const MAX_OUTPUT_TOKENS = 65536;

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const TYPES = [
  'MULTIPLE_CHOICE',
  'SENTENCE_ORDERING',
  'FILL_IN_THE_BLANK',
  'ERROR_CORRECTION',
  'TRUE_FALSE',
  'SYNONYM_ANTONYM',
];

const SYSTEM_INSTRUCTION = `You are an expert English-language exam writer for "Real English Academy".
You are given the content of a scanned worksheet, test, or book (as text, a PDF document, or page images).
Your job is to extract and generate as many high-quality quiz questions as possible from the material, covering every CEFR level present and every question type that fits.

For each question produce a JSON object with EXACTLY these keys:
- "questionType": one of "MULTIPLE_CHOICE", "SENTENCE_ORDERING", "FILL_IN_THE_BLANK", "ERROR_CORRECTION", "TRUE_FALSE", "SYNONYM_ANTONYM"
- "questionText": the question prompt (string). For reading comprehension, include the full passage in this field (e.g. "Read: <passage> — What does the author mean by ...?") so the question is self-contained.
- "options": array of strings. For MULTIPLE_CHOICE/FILL_IN_THE_BLANK/ERROR_CORRECTION/SYNONYM_ANTONYM these are the answer choices (2-6). For TRUE_FALSE use ["True","False"]. For SENTENCE_ORDERING these are the shuffled word tokens.
- "correctAnswer": 0-based index into "options" of the correct choice (for SENTENCE_ORDERING use 0)
- "correctAnswerText": the correct answer as readable text. For SENTENCE_ORDERING use a JSON array string of the tokens in the CORRECT order, e.g. "[\\"I\\",\\"have\\",\\"never\\",\\"seen\\",\\"that\\"]"
- "questionData": object or null. For FILL_IN_THE_BLANK use {"sentenceParts":["She ___ to London twice."]}. For ERROR_CORRECTION use {"correction":"doesn't"}. For SYNONYM_ANTONYM use {"targetWord":"abundant","mode":"SYNONYM"} or {"targetWord":"abundant","mode":"ANTONYM"}. Otherwise null.
- "cefrLevel": one of "A1","A2","B1","B2","C1","C2" (estimate from the material)
- "difficulty": one of "easy","medium","hard"
- "topicSyllabusTag": short grammar/vocabulary topic, e.g. "Present Perfect"
- "explanation": one short sentence explaining why the answer is correct (or null)

Rules:
- If the source already contains questions with answers, transcribe them faithfully.
- If the source is teaching material (a book), generate questions that test it: reading comprehension, vocabulary/synonyms, grammar, fill-in-the-blank, sentence ordering, error correction, true/false. For reading comprehension, the full passage MUST be embedded in the questionText so the question stands alone.
- Every question must be self-contained and unambiguous.
- CRITICAL: A student answering the question will have NOTHING else — no book, no audio, no listening, no previous lesson. Every question must be fully answerable from the question text and its options alone. Never write questions that require the student to have read the book, listened to an audio track, or attended a class. If a page contains a listening exercise, do NOT create questions about what was heard; instead create self-contained questions from the visible text (vocabulary, grammar, sentence structure) or skip it.
- Do NOT invent facts not supported by the material.
- Respond with ONLY a JSON object of the form {"questions":[ ... ]}. No markdown, no explanation.`;

// ─── PDF helpers ─────────────────────────────────────────────────────────────

/**
 * Extract a page range from a PDF as a new standalone PDF (pure JS, no
 * rendering). Used to send a scanned book to Gemini in small chunks so the
 * model reads every page closely instead of skimming the whole document.
 */
async function splitPdfPages(pdfBuffer, start, end) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const count = Math.min(end, src.getPageCount()) - start;
  if (count <= 0) return null;
  const out = await PDFDocument.create();
  const indices = Array.from({ length: count }, (_, i) => start + i);
  const pages = await out.copyPages(src, indices);
  for (const p of pages) out.addPage(p);
  return out.save();
}

async function extractPdfText(pdfBuffer) {
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: pdfBuffer });
    const text = await parser.getText();
    parser.destroy();
    return (typeof text === 'string' ? text : (text.text || '')).trim();
  } catch (err) {
    return '';
  }
}

// ─── Gemini call ─────────────────────────────────────────────────────────────

async function uploadGeminiPdf(apiKey, pdfBuffer, fileName) {
  const startUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`;
  const startResponse = await fetch(startUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(pdfBuffer.length),
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: fileName } }),
  });
  if (!startResponse.ok) {
    throw new Error(`Gemini PDF upload initialization failed (${startResponse.status}): ${await startResponse.text()}`);
  }
  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini PDF upload did not return an upload URL.');

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': 'application/pdf',
    },
    body: pdfBuffer,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Gemini PDF upload failed (${uploadResponse.status}): ${await uploadResponse.text()}`);
  }
  const result = await uploadResponse.json();
  const uploaded = result.file || result;
  if (!uploaded.name || !uploaded.uri) {
    throw new Error('Gemini PDF upload returned no file name or URI.');
  }

  const file = { name: uploaded.name, uri: uploaded.uri };
  try {
    const deadline = Date.now() + 90000;
    while (uploaded.state === 'PROCESSING' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const statusResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${encodeURIComponent(apiKey)}`
      );
      if (!statusResponse.ok) {
        throw new Error(`Gemini PDF processing status failed (${statusResponse.status}): ${await statusResponse.text()}`);
      }
      const statusResult = await statusResponse.json();
      uploaded.state = (statusResult.file || statusResult).state;
      if (uploaded.state === 'FAILED') throw new Error('Gemini could not process the uploaded PDF.');
    }
    if (uploaded.state !== 'ACTIVE') {
      throw new Error(uploaded.state === 'PROCESSING'
        ? 'Gemini PDF processing timed out.'
        : `Gemini PDF upload returned unexpected state "${uploaded.state || 'unknown'}".`);
    }
    return file;
  } catch (err) {
    try {
      await deleteGeminiFile(apiKey, file.name);
    } catch (cleanupErr) {
      console.error('[quiz-extractor] uploaded PDF cleanup failed:', cleanupErr.message);
    }
    throw err;
  }
}

async function deleteGeminiFile(apiKey, fileName) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
    { method: 'DELETE' }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Gemini uploaded-file cleanup failed (${response.status}): ${await response.text()}`);
  }
}

function parseJsonReply(text) {
  if (!text) return null;
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    return null;
  }
}

/**
 * Ask the AI gateway for questions from a batch of Gemini "parts".
 *
 * - Text-only batches (text chunks) go through the full failover chain
 *   (Gemini → Groq → OpenRouter) as a chat completion with strict JSON.
 * - Batches containing a PDF (file_data) or an image (inline_data) are
 *   multimodal and stay on Gemini — Groq/OpenRouter are text-only.
 */
async function callGeminiForQuestions(parts) {
  const hasMultimodal = parts.some((p) => p.file_data || p.inline_data);

  let raw;
  if (hasMultimodal) {
    raw = await geminiFileCompletion({
      system: SYSTEM_INSTRUCTION,
      contents: [{ role: 'user', parts }],
      temperature: 0.2,
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: GEMINI_TIMEOUT_MS,
    });
  } else {
    const text = parts.map((p) => p.text).join('\n\n');
    raw = await chatCompletion({
      system: SYSTEM_INSTRUCTION,
      messages: [{ role: 'user', content: text }],
      temperature: 0.2,
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: GEMINI_TIMEOUT_MS,
      jsonMode: true,
    });
  }

  const parsed = parseJsonReply(raw);
  if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  throw new Error('AI returned unparseable JSON');
}

// ─── Question normalization ──────────────────────────────────────────────────

function normalizeQuestion(raw, sourceFlag) {
  const questionType = TYPES.includes(raw.questionType) ? raw.questionType : 'MULTIPLE_CHOICE';
  const cefrLevel = LEVELS.includes(raw.cefrLevel) ? raw.cefrLevel : 'B1';
  const difficulty = DIFFICULTIES.includes(String(raw.difficulty).toLowerCase())
    ? String(raw.difficulty).toLowerCase()
    : 'medium';

  let options = Array.isArray(raw.options)
    ? raw.options.map((o) => String(o).trim()).filter(Boolean)
    : [];

  let correctAnswer = Number.isInteger(raw.correctAnswer) ? raw.correctAnswer : 0;
  let correctAnswerText = typeof raw.correctAnswerText === 'string' ? raw.correctAnswerText : '';
  let questionData = (raw.questionData && typeof raw.questionData === 'object' && !Array.isArray(raw.questionData))
    ? raw.questionData
    : null;

  if (questionType === 'TRUE_FALSE') {
    options = ['True', 'False'];
    correctAnswer = correctAnswer === 1 ? 1 : 0;
    correctAnswerText = correctAnswer === 1 ? 'False' : 'True';
    questionData = null;
  } else if (questionType === 'SENTENCE_ORDERING') {
    let order = [];
    try {
      order = typeof correctAnswerText === 'string' ? JSON.parse(correctAnswerText) : correctAnswerText;
    } catch (err) {
      order = [];
    }
    if (!Array.isArray(order) || order.length !== options.length) {
      // Fall back: if no valid order, treat the options as already in order.
      order = options;
    }
    correctAnswer = 0;
    correctAnswerText = JSON.stringify(order.map((t) => String(t).trim()));
    questionData = null;
  } else {
    if (options.length < 2) return null;
    if (correctAnswer < 0 || correctAnswer >= options.length) correctAnswer = 0;
    if (!correctAnswerText) correctAnswerText = options[correctAnswer];
    if (questionType === 'FILL_IN_THE_BLANK') {
      if (!questionData || !Array.isArray(questionData.sentenceParts)) {
        questionData = { sentenceParts: [raw.questionText || ''] };
      }
    }
    if (questionType === 'ERROR_CORRECTION' && questionData && !questionData.correction) {
      questionData.correction = correctAnswerText;
    }
    if (questionType === 'SYNONYM_ANTONYM') {
      if (!questionData) questionData = {};
      if (!questionData.targetWord) questionData.targetWord = '';
      if (!['SYNONYM', 'ANTONYM'].includes(questionData.mode)) questionData.mode = 'SYNONYM';
    }
  }

  const questionText = typeof raw.questionText === 'string' ? raw.questionText.trim() : '';
  if (!questionText) return null;

  return {
    questionText,
    questionType,
    cefrLevel,
    difficulty,
    topicSyllabusTag: typeof raw.topicSyllabusTag === 'string' && raw.topicSyllabusTag.trim()
      ? raw.topicSyllabusTag.trim()
      : 'General',
    options,
    correctAnswer,
    correctAnswerText,
    questionData,
    explanation: typeof raw.explanation === 'string' ? raw.explanation.trim() : null,
    sourceFlag: sourceFlag || null,
    isScannedSource: true,
  };
}

// ─── Job processing ──────────────────────────────────────────────────────────

function chunkText(text, size = 8000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks.length ? chunks : [''];
}

/**
 * Process an extraction job end-to-end. Updates the job row as it goes.
 * The uploaded file lives on disk (file.path) and is deleted when the job
 * finishes — so a 1GB upload never sits in RAM and never lingers on disk.
 * @param {object} prisma
 * @param {string} jobId
 * @param {object} file { path, mimetype, originalname } (multer disk file)
 * @param {string} mode 'WORKSHEET' | 'BOOK'
 * @param {string|null} sourceFlag
 */
async function processExtractionJob(prisma, jobId, file, mode, sourceFlag) {
  await prisma.quizExtractionJob.update({ where: { id: jobId }, data: { status: 'PROCESSING' } });

  let uploadedGeminiFile = null;
  let geminiKey = null;
  try {
    const buffer = await fs.promises.readFile(file.path);
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    const isImage = /^image\//.test(file.mimetype);

    let batches = []; // each batch = array of Gemini "parts"
    let totalBatches = 0;
    const allQuestions = [];
    let done = 0;

    const processBatch = async (parts) => {
      try {
        const raw = await callGeminiForQuestions(parts);
        for (const q of raw) {
          const normalized = normalizeQuestion(q, sourceFlag);
          if (normalized) allQuestions.push(normalized);
        }
      } catch (err) {
        console.error(`[quiz-extractor] batch ${done + 1}/${totalBatches} failed:`, err.message);
      }
      done++;
      await prisma.quizExtractionJob.update({ where: { id: jobId }, data: { doneBatches: done } });
    };

    if (isPdf) {
      const text = await extractPdfText(buffer);
      // PDFs with a real text layer are sent as text chunks (cheap + reliable).
      // Scanned PDFs (sparse text) are split into small page chunks and sent
      // to Gemini as documents — no local rendering needed.
      const useText = mode !== 'BOOK' && text.length > 5000;
      if (useText) {
        const chunks = chunkText(text, 12000);
        batches = chunks.map((chunk) => [
          { text: chunk },
          { text: 'Extract as many quiz questions as possible from this text (aim for 15-30 per page of content). IMPORTANT: the student will answer with NOTHING else — no book, no audio. Every question must be fully answerable from its own text and options alone. Skip listening exercises and anything requiring prior knowledge or the source document.' },
        ]);
      } else {
        // Scanned PDF: split into small page chunks (pure JS, no rendering)
        // and send each chunk to Gemini as a document. Small chunks make the
        // model read every page closely, yielding far more questions than
        // sending the whole book in one call.
        geminiKey = await getGeminiKey();
        if (!geminiKey) {
          await prisma.quizExtractionJob.update({
            where: { id: jobId },
            data: { status: 'FAILED', error: 'GEMINI_API_KEY is not configured on the server.' },
          });
          return;
        }
        const { PDFDocument } = require('pdf-lib');
        const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const total = srcDoc.getPageCount();
        const maxPages = mode === 'BOOK' ? 150 : 30;
        const pagesToUse = Math.min(total, maxPages);
        const chunkSize = mode === 'BOOK' ? 10 : 5;
        const chunkCount = Math.ceil(pagesToUse / chunkSize);
        totalBatches = chunkCount;
        await prisma.quizExtractionJob.update({ where: { id: jobId }, data: { totalBatches } });

        for (let c = 0; c < chunkCount; c++) {
          const start = c * chunkSize;
          const end = Math.min(start + chunkSize, pagesToUse);
          const chunkBuffer = await splitPdfPages(buffer, start, end);
          if (!chunkBuffer) continue;
          try {
            uploadedGeminiFile = await uploadGeminiPdf(geminiKey, chunkBuffer, `${file.originalname} (pages ${start + 1}-${end})`);
            const parts = [
              { file_data: { mime_type: 'application/pdf', file_uri: uploadedGeminiFile.uri } },
              { text: `These are pages ${start + 1}-${end} of an English textbook. Extract as many quiz questions as possible from these pages — aim for 15-30 questions per page across all question types (reading comprehension, vocabulary, grammar, fill-in-the-blank, sentence ordering, error correction, true/false, synonyms/antonyms). Do not invent facts not present in these pages. IMPORTANT: the student will answer these questions with NOTHING else — no book, no audio, no listening. Every question must be fully answerable from its own text and options alone. Skip listening exercises and any question that requires prior knowledge, the book, or an audio track.` },
            ];
            await processBatch(parts);
          } finally {
            if (uploadedGeminiFile) {
              try {
                await deleteGeminiFile(geminiKey, uploadedGeminiFile.name);
              } catch (err) {
                console.error('[quiz-extractor] uploaded PDF cleanup failed:', err.message);
              }
              uploadedGeminiFile = null;
            }
          }
        }
      }
    } else if (isImage) {
      batches = [[
        { inline_data: { mime_type: file.mimetype, data: buffer.toString('base64') } },
        { text: 'Extract every question from this image. IMPORTANT: the student will answer with NOTHING else — no book, no audio. Every question must be fully answerable from its own text and options alone. Skip listening exercises and anything requiring prior knowledge or the source document.' },
      ]];
    } else {
      await prisma.quizExtractionJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: 'Unsupported file type. Upload a PDF or image.' },
      });
      return;
    }

    if (batches.length) {
      totalBatches = batches.length;
      await prisma.quizExtractionJob.update({ where: { id: jobId }, data: { totalBatches } });
    }
    for (const parts of batches) {
      await processBatch(parts);
    }

    // Deduplicate by question text + type.
    const seen = new Set();
    const unique = [];
    for (const q of allQuestions) {
      const key = `${q.questionType}|${q.questionText.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(q);
    }

    await prisma.quizExtractionJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        questionsJson: JSON.stringify(unique),
        doneBatches: totalBatches,
      },
    });
    console.log(`[quiz-extractor] job ${jobId} completed with ${unique.length} questions`);
  } finally {
      if (uploadedGeminiFile && geminiKey) {
      try {
          await deleteGeminiFile(geminiKey, uploadedGeminiFile.name);
      } catch (err) {
        console.error('[quiz-extractor] uploaded PDF cleanup failed:', err.message);
      }
    }
    // Always remove the uploaded file once the job is done (success or failure).
    fs.unlink(file.path, () => {});
  }
}

module.exports = { processExtractionJob, normalizeQuestion };
