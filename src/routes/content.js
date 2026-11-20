const express = require('express');
const prisma = require('../prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/content/:page
 * Public. Returns all content elements for a page key, e.g. /api/content/home
 * Response: { page: 'home', elements: { hero_title: { content, styles }, ... } }
 */
router.get('/:page', async (req, res) => {
  try {
    const rows = await prisma.pageContents.findMany({
      where: { page_key: req.params.page },
    });

    const elements = {};
    for (const row of rows) {
      let styles = null;
      if (row.styles) {
        try { styles = JSON.parse(row.styles); } catch { styles = null; }
      }
      elements[row.element_id] = { content: row.content, styles };
    }

    res.json({ page: req.params.page, elements });
  } catch (err) {
    console.error('Content fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/content/update
 * Admin only. Body: { page: 'home', elements: { hero_title: { content, styles }, ... } }
 * Upserts each element.
 */
router.put('/update', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { page, elements } = req.body || {};
    if (!page || !elements || typeof elements !== 'object') {
      return res.status(400).json({ error: 'page and elements are required' });
    }

    const results = await Promise.all(
      Object.entries(elements).map(([element_id, value]) =>
        prisma.pageContents.upsert({
          where: { page_key_element_id: { page_key: page, element_id } },
          create: {
            page_key: page,
            element_id,
            content: value.content ?? '',
            styles: value.styles ? JSON.stringify(value.styles) : null,
          },
          update: {
            content: value.content ?? '',
            styles: value.styles ? JSON.stringify(value.styles) : null,
          },
        })
      )
    );

    res.json({ ok: true, updated: results.length });
  } catch (err) {
    console.error('Content update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
