/**
 * Gemini AI title + body generator for Instagram announcements.
 *
 * For each Instagram post caption, asks the AI gateway (Gemini → Groq →
 * OpenRouter, with automatic failover) to return strict JSON:
 *   {
 *     "title": "short professional Greek title (<=80 chars)",
 *     "formattedBody": "<p>...</p><p>...</p>"  // clean HTML paragraphs
 *   }
 *
 * If the post has no caption, the caller passes a flag and we use a default
 * title without calling the AI for the title (body is empty).
 */

const { chatCompletion } = require('./aiProvider');

const SYSTEM_INSTRUCTION = `You are a professional content editor for "Real English Academy", an English language school in Greece.
You are given the raw caption text of an Instagram post. Produce a JSON object with exactly two keys:

1. "title": A short, clean, professional title in GREEK (Ελληνικά), at most 80 characters, based on the meaning of the caption. No hashtags, no emojis, no marketing spam. If the caption is in English, translate the meaning into a natural Greek title.

2. "formattedBody": The full caption text cleaned of trailing hashtags and contact-info spam, formatted as clean HTML paragraphs. Each paragraph is wrapped in <p>...</p>. Preserve line breaks as separate paragraphs. Keep the original language of the text (Greek stays Greek, English stays English). Remove any trailing lines that are only hashtags (#word) or phone/address contact lines. Do NOT add any extra commentary.

Respond with ONLY valid JSON. No markdown fences, no explanation.`;

/**
 * Parse the JSON out of an AI reply (tolerates stray markdown fences).
 */
function parseJsonReply(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Strip markdown code fences if present.
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  // Find the first { ... } block.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Generate a title + formatted body for an Instagram caption.
 * @param {string} caption - raw caption text (may be empty)
 * @returns {Promise<{title: string, formattedBody: string}>}
 */
async function generateTitleAndBody(caption) {
  const trimmed = (caption || '').trim();

  // No caption at all → default title, empty body.
  if (!trimmed) {
    return {
      title: 'Νέα Δημοσίευση από το Real English Academy',
      formattedBody: '',
    };
  }

  const raw = await chatCompletion({
    system: SYSTEM_INSTRUCTION,
    messages: [{ role: 'user', content: trimmed }],
    temperature: 0.3,
    maxTokens: 2048,
    timeoutMs: 60000,
    jsonMode: true,
  });
  const parsed = parseJsonReply(raw);
  if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
    const title = parsed.title.trim().slice(0, 80);
    const formattedBody =
      typeof parsed.formattedBody === 'string' ? parsed.formattedBody.trim() : '';
    return { title, formattedBody };
  }
  throw new Error('AI returned unparseable JSON for the announcement');
}

module.exports = { generateTitleAndBody };
