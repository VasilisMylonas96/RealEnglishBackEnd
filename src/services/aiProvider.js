/**
 * aiProvider — unified AI gateway with automatic failover.
 *
 * Provider chain (in order):  gemini  →  groq  →  openrouter
 *
 * Behaviour:
 *   - Normally everything goes to Gemini (the primary, multimodal provider).
 *   - When Gemini's quota is exhausted (429 / RESOURCE_EXHAUSTED) we switch to
 *     Groq for the REST OF THE DAY and remember that in the DB
 *     (AiProviderState). The next day the lock expires and we try Gemini again.
 *   - If Groq is also exhausted we switch to OpenRouter the same way.
 *   - API keys are read from the AiApiKey table (provider/site/apiKey). The
 *     table has NO API endpoint — it is inspected/edited in the DB only.
 *     Env vars (GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY) are used
 *     as a fallback if a provider row is missing.
 *
 * Two entry points:
 *   - chatCompletion(opts)        → text chat, full failover chain.
 *   - geminiFileCompletion(opts)  → Gemini-only, for PDF file_data (scanned
 *                                   books). Groq/OpenRouter are text-only and
 *                                   cannot read a PDF, so this stays on Gemini
 *                                   and reports a clear error when Gemini is
 *                                   locked out for the day.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ── Provider chain ───────────────────────────────────────────────────────────
const CHAIN = ['gemini', 'groq', 'openrouter'];

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
].filter(Boolean);

const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen-2.5-72b-instruct:free',
];

const ENV_KEY = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const OPENROUTER_HEADERS = {
  'HTTP-Referer': process.env.APP_BASE_URL || 'http://localhost:3000',
  'X-Title': 'Real English Academy',
};

// ── API key cache (5 min) ────────────────────────────────────────────────────
let keyCache = null;
let keyCacheAt = 0;
const KEY_TTL_MS = 5 * 60 * 1000;

async function getKey(provider) {
  const now = Date.now();
  if (!keyCache || now - keyCacheAt > KEY_TTL_MS) {
    try {
      const rows = await prisma.aiApiKey.findMany();
      keyCache = Object.fromEntries(rows.map((r) => [r.provider, r.apiKey]));
      keyCacheAt = now;
    } catch (err) {
      console.error('[ai-provider] failed to load API keys from DB:', err.message);
      keyCache = {};
      keyCacheAt = now;
    }
  }
  return keyCache[provider] || process.env[ENV_KEY[provider]] || null;
}

// ── Daily lockout state ──────────────────────────────────────────────────────
async function getActiveProvider() {
  try {
    const state = await prisma.aiProviderState.findUnique({ where: { id: 'default' } });
    if (state && state.lockedUntil > new Date() && state.activeProvider !== 'gemini') {
      return state.activeProvider;
    }
  } catch (err) {
    console.error('[ai-provider] failed to read provider state:', err.message);
  }
  return 'gemini';
}

async function lockProvider(provider) {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  try {
    await prisma.aiProviderState.upsert({
      where: { id: 'default' },
      create: { id: 'default', activeProvider: provider, lockedUntil: endOfDay },
      update: { activeProvider: provider, lockedUntil: endOfDay },
    });
    console.warn(
      `[ai-provider] ${provider} locked in as active provider until ${endOfDay.toISOString()} (primary exhausted)`
    );
  } catch (err) {
    console.error('[ai-provider] failed to persist provider lock:', err.message);
  }
}

function nextInChain(provider) {
  const i = CHAIN.indexOf(provider);
  return i >= 0 && i < CHAIN.length - 1 ? CHAIN[i + 1] : null;
}

function rotateChain(start) {
  const i = CHAIN.indexOf(start);
  if (i <= 0) return [...CHAIN];
  return [...CHAIN.slice(i), ...CHAIN.slice(0, i)];
}

// ── Error helpers ────────────────────────────────────────────────────────────
function isQuotaError(status, detail) {
  if (status === 429) return true;
  const d = (detail || '').toLowerCase();
  return (
    d.includes('resource_exhausted') ||
    d.includes('quota') ||
    d.includes('rate limit') ||
    d.includes('billing') ||
    d.includes('exceeded your')
  );
}

// ── Gemini ───────────────────────────────────────────────────────────────────
async function callGeminiModel(key, model, system, contents, temperature, maxTokens, timeoutMs) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(key)}`;
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const e = new Error(`Gemini ${model} unreachable (${err.message})`);
    e.fallback = true;
    throw e;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    if (isQuotaError(resp.status, detail)) {
      const e = new Error(`Gemini ${model} quota exhausted (${resp.status})`);
      e.quotaExhausted = true;
      throw e;
    }
    if (resp.status === 404 || resp.status === 503) {
      const e = new Error(`Gemini ${model} unavailable (${resp.status})`);
      e.fallback = true;
      throw e;
    }
    console.error(`[ai-provider] Gemini API error ${resp.status}:`, detail.slice(0, 400));
    const e = new Error(`Gemini API error (${resp.status})`);
    e.status = resp.status;
    throw e;
  }

  const data = await resp.json();
  const candidate = data.candidates && data.candidates[0];
  const text =
    candidate && candidate.content && Array.isArray(candidate.content.parts)
      ? candidate.content.parts.map((p) => p.text || '').join('')
      : '';
  return text.trim();
}

/**
 * Call Gemini with a fallback model chain. `contents` is a Gemini contents
 * array (so callers can include file_data / inline_data parts).
 */
async function callGemini({ system, contents, temperature = 0.4, maxTokens = 2048, timeoutMs = 60000 }) {
  const key = await getKey('gemini');
  if (!key) throw new Error('GEMINI_API_KEY is not configured.');
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const text = await callGeminiModel(key, model, system, contents, temperature, maxTokens, timeoutMs);
      if (text) return text;
      lastErr = new Error(`Gemini ${model} returned empty reply`);
    } catch (err) {
      lastErr = err;
      if (err.quotaExhausted) throw err; // don't burn other models — quota is account-wide
      if (!err.fallback) throw err;
      console.warn(`[ai-provider] Gemini falling back from ${model} — ${err.message}`);
    }
  }
  throw lastErr || new Error('No Gemini model available');
}

// ── OpenAI-compatible (Groq + OpenRouter) ────────────────────────────────────
async function callOpenAICompatible({ baseUrl, key, model, system, messages, temperature, maxTokens, timeoutMs, jsonMode, extraHeaders }) {
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const e = new Error(`${model} unreachable (${err.message})`);
    e.fallback = true;
    throw e;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    if (isQuotaError(resp.status, detail)) {
      const e = new Error(`${model} quota exhausted (${resp.status})`);
      e.quotaExhausted = true;
      throw e;
    }
    // Some free models reject response_format — retry once without it.
    if (jsonMode && resp.status === 400 && /response_format|json/i.test(detail)) {
      delete body.response_format;
      const retry = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extraHeaders },
        body: JSON.stringify(body),
      });
      if (retry.ok) {
        const data = await retry.json();
        return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      }
    }
    if (resp.status === 503 || resp.status === 500 || resp.status === 429) {
      const e = new Error(`${model} unavailable (${resp.status})`);
      e.fallback = true;
      if (resp.status === 429) e.quotaExhausted = true;
      throw e;
    }
    console.error(`[ai-provider] ${model} API error ${resp.status}:`, detail.slice(0, 400));
    const e = new Error(`${model} API error (${resp.status})`);
    e.status = resp.status;
    throw e;
  }

  const data = await resp.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

async function callGroq(opts) {
  const key = await getKey('groq');
  if (!key) throw new Error('GROQ_API_KEY is not configured.');
  let lastErr = null;
  for (const model of GROQ_MODELS) {
    try {
      const text = await callOpenAICompatible({
        baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
        key,
        model,
        ...opts,
      });
      if (text) return text;
      lastErr = new Error(`Groq ${model} returned empty reply`);
    } catch (err) {
      lastErr = err;
      if (err.quotaExhausted) throw err;
      if (!err.fallback) throw err;
      console.warn(`[ai-provider] Groq falling back from ${model} — ${err.message}`);
    }
  }
  throw lastErr || new Error('No Groq model available');
}

async function callOpenRouter(opts) {
  const key = await getKey('openrouter');
  if (!key) throw new Error('OPENROUTER_API_KEY is not configured.');
  let lastErr = null;
  for (const model of OPENROUTER_MODELS) {
    try {
      const text = await callOpenAICompatible({
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        key,
        model,
        extraHeaders: OPENROUTER_HEADERS,
        ...opts,
      });
      if (text) return text;
      lastErr = new Error(`OpenRouter ${model} returned empty reply`);
    } catch (err) {
      lastErr = err;
      if (err.quotaExhausted) throw err;
      if (!err.fallback) throw err;
      console.warn(`[ai-provider] OpenRouter falling back from ${model} — ${err.message}`);
    }
  }
  throw lastErr || new Error('No OpenRouter model available');
}

// ── Public API ───────────────────────────────────────────────────────────────
/**
 * Text chat completion with full failover.
 * @param {object} opts
 * @param {string} [opts.system]      system instruction
 * @param {Array}  opts.messages      [{ role: 'user'|'assistant', content: string }]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {boolean}[opts.jsonMode]    request strict JSON (OpenAI response_format)
 * @returns {Promise<string>} the model's text reply
 */
async function chatCompletion(opts) {
  const {
    system,
    messages,
    temperature = 0.4,
    maxTokens = 2048,
    timeoutMs = 60000,
    jsonMode = false,
  } = opts;

  const start = await getActiveProvider();
  const order = rotateChain(start);
  let lastErr = null;

  for (const provider of order) {
    try {
      let text;
      if (provider === 'gemini') {
        const contents = messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
        text = await callGemini({ system, contents, temperature, maxTokens, timeoutMs });
      } else if (provider === 'groq') {
        text = await callGroq({ system, messages, temperature, maxTokens, timeoutMs, jsonMode });
      } else {
        text = await callOpenRouter({ system, messages, temperature, maxTokens, timeoutMs, jsonMode });
      }
      if (text) return text;
      lastErr = new Error(`${provider} returned empty reply`);
    } catch (err) {
      lastErr = err;
      if (err.quotaExhausted) {
        const next = nextInChain(provider);
        if (next) {
          console.warn(`[ai-provider] ${provider} quota exhausted — switching to ${next} until end of day`);
          await lockProvider(next);
        }
        continue;
      }
      if (err.fallback) {
        console.warn(`[ai-provider] ${provider} failed — ${err.message}`);
        continue;
      }
      throw err; // non-retryable (auth, bad request, etc.)
    }
  }
  throw lastErr || new Error('No AI provider available');
}

/**
 * Gemini-only completion that can include a PDF file_data part (scanned books).
 * Groq/OpenRouter are text-only, so when Gemini is locked out for the day this
 * throws a clear, user-facing error instead of silently producing 0 questions.
 * @param {object} opts
 * @param {string} opts.system
 * @param {Array}  opts.contents  Gemini contents array (may include file_data)
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>}
 */
async function geminiFileCompletion(opts) {
  const active = await getActiveProvider();
  if (active !== 'gemini') {
    const e = new Error(
      'Gemini is currently unavailable (quota exhausted until end of day). Scanned-PDF extraction requires Gemini — please try again tomorrow.'
    );
    e.quotaExhausted = true;
    throw e;
  }
  try {
    return await callGemini(opts);
  } catch (err) {
    if (err.quotaExhausted) {
      const next = nextInChain('gemini');
      if (next) await lockProvider(next);
    }
    throw err;
  }
}

module.exports = { chatCompletion, geminiFileCompletion, getActiveProvider, getGeminiKey: () => getKey('gemini') };
