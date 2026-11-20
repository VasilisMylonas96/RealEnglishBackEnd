const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const prisma = require('../prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { publicBaseUrl } = require('../services/urls');
const { getUploadsDir } = require('../services/uploadsPath');

const router = express.Router();

const UPLOADS_DIR = getUploadsDir();

// Multer: keep files in memory so sharp can process the buffer directly.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

/**
 * GET /api/media/categories
 * Public. Returns all gallery categories ordered by sortOrder.
 */
router.get('/categories', async (req, res) => {
  try {
    const categories = await prisma.mediaCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(categories);
  } catch (err) {
    console.error('Categories list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/media/categories
 * Admin only. Body: { name } — creates a new category (slug auto-generated).
 */
router.post(
  '/categories',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res) => {
    try {
      const name = (req.body.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }
      // Slug: lowercase, non-alphanumeric -> '-', dedupe with a counter.
      let slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (!slug) slug = 'category';
      const base = slug;
      let i = 2;
      while (await prisma.mediaCategory.findUnique({ where: { slug } })) {
        slug = `${base}-${i++}`;
      }
      const maxOrder = await prisma.mediaCategory.aggregate({ _max: { sortOrder: true } });
      const category = await prisma.mediaCategory.create({
        data: { name, slug, sortOrder: (maxOrder._max.sortOrder || 0) + 1 },
      });
      res.status(201).json(category);
    } catch (err) {
      console.error('Category create error:', err);
      res.status(500).json({ error: 'Failed to create category' });
    }
  }
);

/**
 * DELETE /api/media/categories/:id
 * Admin only. Deletes the category AND all its photos (files + DB rows).
 */
router.delete(
  '/categories/:id',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res) => {
    try {
      const category = await prisma.mediaCategory.findUnique({
        where: { id: req.params.id },
      });
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }

      // Delete all photos in this category (files + rows).
      const assets = await prisma.mediaAsset.findMany({
        where: { gallery_id: category.slug },
      });
      for (const asset of assets) {
        const filePath = path.join(UPLOADS_DIR, asset.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      await prisma.mediaAsset.deleteMany({ where: { gallery_id: category.slug } });
      await prisma.mediaCategory.delete({ where: { id: category.id } });

      res.json({ ok: true });
    } catch (err) {
      console.error('Category delete error:', err);
      res.status(500).json({ error: 'Failed to delete category' });
    }
  }
);

/**
 * GET /api/media/:gallery_id
 * Public. Returns light URL objects: [{ id, url, sortOrder }]
 */
router.get('/:gallery_id', async (req, res) => {
  try {
    const assets = await prisma.mediaAsset.findMany({
      where: { gallery_id: req.params.gallery_id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(
      assets.map((a) => ({
        id: a.id,
        url: `${publicBaseUrl(req)}${a.url}`,
        sortOrder: a.sortOrder,
      }))
    );
  } catch (err) {
    console.error('Media list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/media/upload
 * Admin only. multipart/form-data with field `file` and `gallery_id`.
 * Optimizes to WebP with sharp, stores in /uploads, returns the permanent URL.
 */
router.post(
  '/upload',
  requireAuth,
  requireRole('ADMIN'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided (field name: file)' });
      }
      const gallery_id = req.body.gallery_id || 'gallery';

      const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
      const target = path.join(UPLOADS_DIR, filename);

      // Optimize: WebP, quality 80, max 1920px wide (keeps CDN payload small).
      const metadata = await sharp(req.file.buffer)
        .rotate() // respect EXIF orientation
        .resize({ width: 1920, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(target);

      const asset = await prisma.mediaAsset.create({
        data: {
          gallery_id,
          url: `/uploads/${filename}`,
          filename,
          originalName: req.file.originalname,
          mimeType: 'image/webp',
          size: metadata.size,
          width: metadata.width,
          height: metadata.height,
        },
      });

      res.status(201).json({
        id: asset.id,
        url: `${publicBaseUrl(req)}${asset.url}`,
        gallery_id,
      });
    } catch (err) {
      console.error('Media upload error:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

/**
 * DELETE /api/media/:id
 * Admin only. Removes the DB record and the file from disk.
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  async (req, res) => {
    try {
      const asset = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
      if (!asset) {
        return res.status(404).json({ error: 'Media asset not found' });
      }

      await prisma.mediaAsset.delete({ where: { id: asset.id } });

      const filePath = path.join(UPLOADS_DIR, asset.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      res.json({ ok: true });
    } catch (err) {
      console.error('Media delete error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
