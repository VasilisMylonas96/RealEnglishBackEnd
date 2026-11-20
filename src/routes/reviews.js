const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACE_ID = process.env.GOOGLE_PLACE_ID;

// Simple in-memory cache (10 min TTL) for the Google portion.
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 10 * 60 * 1000;

/**
 * GET /api/reviews/mine
 * Authenticated. Returns the current user's in-house review, if any.
 */
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const review = await prisma.review.findUnique({
      where: { userId: req.user.id },
    });
    res.json({ review });
  } catch (err) {
    console.error('Own review fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch your review' });
  }
});

/**
 * POST /api/reviews
 * Authenticated. Creates or updates the current user's single in-house review.
 * Body: { rating: 1..5, text?: string }
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const text = req.body?.text === undefined ? '' : req.body.text;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
    }
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'Review comment must be text' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Review comment must be 2000 characters or fewer' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, firstName: true, lastName: true, username: true, avatarUrl: true, role: true },
    });
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const author = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username;
    const review = await prisma.review.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        role: user.role,
        author,
        rating,
        text: text.trim(),
        photo: user.avatarUrl,
        reviewDate: new Date(),
      },
      update: {
        role: user.role,
        author,
        rating,
        text: text.trim(),
        photo: user.avatarUrl,
        reviewDate: new Date(),
      },
    });

    res.status(201).json({ review });
  } catch (err) {
    console.error('Review submission error:', err.message);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

/**
 * GET /api/reviews
 * Public. Returns a single merged list of reviews:
 *   - Google reviews (fetched live from the Places API, source: 'google')
 *   - In-house site reviews (from the DB, source: 'site')
 * Each item: { id, source, author, photo, rating, text, date }
 * Also returns a combined rating summary.
 */
router.get('/', async (req, res) => {
  try {
    // --- Google reviews (live, cached) ---
    let google = cache.data;
    if (!google || Date.now() - cache.timestamp >= CACHE_TTL) {
      const url = `https://places.googleapis.com/v1/places/${PLACE_ID}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask':
            'id,displayName,rating,userRatingCount,reviews.rating,reviews.originalText,reviews.text,reviews.publishTime,reviews.authorAttribution.displayName,reviews.authorAttribution.photoUri',
        },
      });

      if (response.ok) {
        const data = await response.json();
        google = {
          rating: data.rating || 0,
          ratingCount: data.userRatingCount || 0,
          mapsUrl: `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`,
          reviews: (data.reviews || []).map((r) => ({
            id: r.name,
            source: 'google',
            author: r.authorAttribution?.displayName || 'Google User',
            photo: r.authorAttribution?.photoUri || null,
            rating: r.rating || 0,
            // Prefer the original (Greek) text, fall back to the translated one.
            text: r.originalText?.text || r.text?.text || '',
            date: r.publishTime || '',
          })),
        };
        cache = { data: google, timestamp: Date.now() };
      } else {
        const errBody = await response.text();
        console.error('Google Places API error:', response.status, errBody);
        google = { rating: 0, ratingCount: 0, mapsUrl: '', reviews: [] };
      }
    }

    // --- In-house (site) reviews from the DB ---
    const siteRows = await prisma.review.findMany({
      orderBy: [{ sortOrder: 'asc' }, { reviewDate: 'desc' }],
    });
    const siteReviews = siteRows.map((r) => ({
      id: r.id,
      source: 'site',
      author: r.author,
      photo: r.photo || null,
      role: r.role || null,
      rating: r.rating,
      text: r.text,
      date: r.reviewDate ? new Date(r.reviewDate).toISOString() : '',
    }));

    // --- Merge into one list, newest first ---
    const all = [...google.reviews, ...siteReviews].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    // --- Combined rating summary (Google + site) ---
    const totalCount = google.ratingCount + siteReviews.length;
    const siteTotal = siteReviews.reduce((sum, r) => sum + r.rating, 0);
    const combinedRating =
      totalCount > 0
        ? Math.round(((google.rating * google.ratingCount + siteTotal) / totalCount) * 10) / 10
        : 0;

    res.json({
      rating: combinedRating,
      ratingCount: totalCount,
      mapsUrl: google.mapsUrl,
      reviews: all,
    });
  } catch (err) {
    console.error('Reviews fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

module.exports = router;
