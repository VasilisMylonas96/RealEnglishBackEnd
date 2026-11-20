const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const prisma = require('../prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { publicBaseUrl } = require('../services/urls');
const { notifyStudentsOfAnnouncement } = require('../services/email');
const { generateTitleAndBody } = require('../services/geminiAnnouncement');
const { fetchAllPosts, downloadImageLocally } = require('../services/instagram');
const { getUploadsSubDir } = require('../services/uploadsPath');

const router = express.Router();

const UPLOADS_DIR = getUploadsSubDir('announcements');

// ─── HTML sanitizer ──────────────────────────────────────────────────────────
// Whitelist-based: keeps a safe set of tags/attributes, strips scripts,
// event handlers, and javascript: URLs. Good enough for rich-text content
// authored by trusted staff (ADMIN/TEACHER).

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'a', 'img', 'span', 'div', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'hr', 'figure', 'figcaption',
]);

const ALLOWED_ATTRS = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'style'],
  span: ['style'],
  div: ['style'],
  td: ['style', 'colspan', 'rowspan'],
  th: ['style', 'colspan', 'rowspan'],
  p: ['style'],
  h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], h5: ['style'], h6: ['style'],
  blockquote: ['style'],
};

function isSafeUrl(url) {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase().replace(/[\u0000-\u0020]/g, '');
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:text/html') || trimmed.startsWith('vbscript:')) {
    return false;
  }
  return true;
}

/**
 * Sanitize an HTML string: parse tag by tag, keep whitelisted tags and
 * attributes, drop everything else (script/style/iframe/event handlers).
 */
function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  let out = '';
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    // Text between tags: keep as-is (browsers escape it on render).
    out += html.slice(last, m.index);
    last = tagRe.lastIndex;

    const isClosing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrStr = m[3] || '';

    if (!ALLOWED_TAGS.has(tag)) continue; // drop disallowed tags entirely

    if (isClosing) {
      out += `</${tag}>`;
      continue;
    }

    // Parse attributes.
    const allowed = ALLOWED_ATTRS[tag] || [];
    const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
    let attrs = '';
    let am;
    while ((am = attrRe.exec(attrStr)) !== null) {
      const name = am[1].toLowerCase();
      if (!allowed.includes(name)) continue;
      if (name.startsWith('on')) continue;
      let value = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : am[2] || '';
      if (name === 'href' || name === 'src') {
        if (!isSafeUrl(value)) continue;
      }
      if (name === 'style') {
        // Strip url() and expression() from inline styles.
        value = value.replace(/url\s*\([^)]*\)/gi, '').replace(/expression\s*\([^)]*\)/gi, '');
      }
      attrs += ` ${name}="${value.replace(/"/g, '&quot;')}"`;
    }

    // Force safe target/rel on links.
    if (tag === 'a') {
      if (!/target=/.test(attrs)) attrs += ' target="_blank"';
      if (!/rel=/.test(attrs)) attrs += ' rel="noopener noreferrer"';
    }

    out += `<${tag}${attrs}>`;
  }
  out += html.slice(last);
  return out;
}

// ─── Multer for image uploads ────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

// ─── Public reads ────────────────────────────────────────────────────────────

/**
 * GET /api/announcements
 * Public. All announcements, newest first.
 */
router.get('/', async (req, res) => {
  try {
    const items = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(items);
  } catch (err) {
    console.error('Announcements list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/announcements/:id
 * Public. A single announcement.
 */
router.get('/:id', async (req, res) => {
  try {
    const item = await prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Announcement not found' });
    res.json(item);
  } catch (err) {
    console.error('Announcement get error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Staff writes (ADMIN / TEACHER) ──────────────────────────────────────────

/**
 * POST /api/announcements
 * ADMIN/TEACHER. Body: { title, content, authorName? }
 * Creates the announcement and asynchronously emails all students.
 */
router.post(
  '/',
  requireAuth,
  requireRole('TEACHER'),
  async (req, res) => {
    try {
      const title = (req.body.title || '').trim();
      const content = sanitizeHtml(req.body.content || '');
      const authorName = (req.body.authorName || '').trim() || 'Real English Academy';
      if (!title) return res.status(400).json({ error: 'title is required' });

      const announcement = await prisma.announcement.create({
        data: { title, content, authorName, source: 'MANUAL' },
      });

      // Fire-and-forget email to all students.
      notifyStudentsOfAnnouncement(announcement).catch((err) => {
        console.error('[announcements] Email notification failed:', err.message);
      });

      res.status(201).json(announcement);
    } catch (err) {
      console.error('Announcement create error:', err);
      res.status(500).json({ error: 'Failed to create announcement' });
    }
  }
);

/**
 * PUT /api/announcements/:id
 * ADMIN/TEACHER. Full replace of title + content.
 */
router.put(
  '/:id',
  requireAuth,
  requireRole('TEACHER'),
  async (req, res) => {
    try {
      const existing = await prisma.announcement.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Announcement not found' });

      const title = (req.body.title || '').trim();
      const content = sanitizeHtml(req.body.content || '');
      if (!title) return res.status(400).json({ error: 'title is required' });

      const updated = await prisma.announcement.update({
        where: { id: existing.id },
        data: { title, content },
      });
      res.json(updated);
    } catch (err) {
      console.error('Announcement update error:', err);
      res.status(500).json({ error: 'Failed to update announcement' });
    }
  }
);

/**
 * DELETE /api/announcements/:id
 * ADMIN/TEACHER. Permanently deletes the announcement.
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('TEACHER'),
  async (req, res) => {
    try {
      const existing = await prisma.announcement.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Announcement not found' });
      await prisma.announcement.delete({ where: { id: existing.id } });
      res.json({ ok: true });
    } catch (err) {
      console.error('Announcement delete error:', err);
      res.status(500).json({ error: 'Failed to delete announcement' });
    }
  }
);

/**
 * POST /api/announcements/upload-image
 * ADMIN/TEACHER. multipart/form-data with field `file`.
 * Optimizes to WebP, stores under /uploads/announcements/, returns the URL.
 */
router.post(
  '/upload-image',
  requireAuth,
  requireRole('TEACHER'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file provided (field name: file)' });

      const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
      const target = path.join(UPLOADS_DIR, filename);

      const metadata = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(target);

      res.status(201).json({
        url: `${publicBaseUrl(req)}/uploads/announcements/${filename}`,
        path: `/uploads/announcements/${filename}`,
        width: metadata.width,
        height: metadata.height,
      });
    } catch (err) {
      console.error('Announcement image upload error:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

// ─── Instagram sync ──────────────────────────────────────────────────────────

/**
 * POST /api/announcements/sync-instagram?sendEmails=true|false
 * ADMIN/TEACHER. Fetches all public posts from @real.englishacademy, imports
 * any that are not already in the DB (dedup by shortcode), generates titles
 * with Gemini, downloads images locally, and optionally emails students.
 */
router.post(
  '/sync-instagram',
  requireAuth,
  requireRole('TEACHER'),
  async (req, res) => {
    const sendEmails = req.query.sendEmails !== 'false';
    try {
      const result = await syncInstagram({ sendEmails });
      res.json(result);
    } catch (err) {
      console.error('Instagram sync error:', err);
      res.status(500).json({ error: `Instagram sync failed: ${err.message}` });
    }
  }
);

/**
 * Core sync logic (shared by the endpoint and the hourly scheduler).
 * @param {{sendEmails: boolean}} opts
 */
async function syncInstagram({ sendEmails }) {
  const posts = await fetchAllPosts();
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const post of posts) {
    try {
      // Dedup: shortcode is the stable Instagram media id.
      const existing = await prisma.announcement.findUnique({
        where: { instagramMediaId: post.shortcode },
      });
      if (existing) {
        skipped++;
        continue;
      }

      // 1. Download the image locally (CDN URLs expire).
      let localImageUrl = null;
      if (post.imageUrl) {
        try {
          localImageUrl = await downloadImageLocally(post.imageUrl);
        } catch (err) {
          console.error(`[sync] Image download failed for ${post.shortcode}:`, err.message);
        }
      }

      // 2. Gemini: title + formatted body.
      const { title, formattedBody } = await generateTitleAndBody(post.caption);

      // 3. Compose the rich HTML content.
      const parts = [];
      if (localImageUrl) {
        parts.push(`<img src="${localImageUrl}" alt="${title}" style="max-width:100%;height:auto;border-radius:12px;" />`);
      }
      if (formattedBody) parts.push(formattedBody);
      parts.push(
        `<p><a href="${post.postUrl}" target="_blank" rel="noopener noreferrer">Δείτε τη δημοσίευση στο Instagram</a></p>`
      );

      // 4. Store with the real post date.
      const announcement = await prisma.announcement.create({
        data: {
          title,
          content: parts.join('\n'),
          authorName: 'Real English Academy',
          source: 'INSTAGRAM',
          instagramMediaId: post.shortcode,
          createdAt: post.date || new Date(),
        },
      });
      imported++;
      console.log(`[sync] Imported "${title}" (${post.shortcode})`);

      // 5. Optional email notification.
      if (sendEmails) {
        notifyStudentsOfAnnouncement(announcement).catch((err) => {
          console.error('[sync] Email notification failed:', err.message);
        });
      }
    } catch (err) {
      failed++;
      errors.push({ shortcode: post.shortcode, error: err.message });
      console.error(`[sync] Failed to import ${post.shortcode}:`, err.message);
    }
  }

  return { total: posts.length, imported, skipped, failed, errors };
}

/**
 * Hourly scheduler: check for new Instagram posts (sendEmails: true).
 */
let syncRunning = false;
function startInstagramSyncScheduler() {
  const run = () => {
    if (syncRunning) return;
    syncRunning = true;
    syncInstagram({ sendEmails: true })
      .then((r) => {
        if (r.imported > 0) console.log(`[sync] Hourly sync imported ${r.imported} new post(s).`);
      })
      .catch((err) => console.error('[sync] Hourly sync failed:', err.message))
      .finally(() => {
        syncRunning = false;
      });
  };
  // First run 2 minutes after boot (let the server warm up), then hourly.
  const initial = setTimeout(run, 2 * 60 * 1000);
  const interval = setInterval(run, 60 * 60 * 1000);
  if (typeof initial.unref === 'function') initial.unref();
  if (typeof interval.unref === 'function') interval.unref();
  return interval;
}

module.exports = router;
module.exports.syncInstagram = syncInstagram;
module.exports.startInstagramSyncScheduler = startInstagramSyncScheduler;
module.exports.sanitizeHtml = sanitizeHtml;
