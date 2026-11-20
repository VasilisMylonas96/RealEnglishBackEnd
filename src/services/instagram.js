/**
 * Instagram public post fetcher (Playwright-based).
 *
 * Instagram only serves the server-rendered og: meta tags (og:image,
 * og:description, og:title) to real browsers with cookies or to known
 * crawlers. A plain Node fetch gets the JS app shell instead. So we drive a
 * headless Chromium via Playwright for the whole sync:
 *
 *   1. Load the public profile page, extract all post shortcodes from the
 *      grid, clicking "Show more posts" until the grid is fully loaded.
 *   2. For each shortcode, navigate to the post page and read the og: meta
 *      tags from the DOM (caption, date, image URL).
 *   3. Download the CDN image locally (Instagram CDN URLs expire in days) and
 *      store it as an optimized WebP under /uploads/announcements/.
 *
 * No Instagram credentials are required — everything uses the public web.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { getUploadsSubDir } = require('./uploadsPath');

const UPLOADS_DIR = getUploadsSubDir('announcements');

const IG_USERNAME = 'real.englishacademy';
const IG_PROFILE_URL = `https://www.instagram.com/${IG_USERNAME}/`;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Launch a browser context with a realistic desktop profile.
 */
async function launchContext() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  return { browser, context };
}

/** Dismiss the cookie consent dialog if present. */
async function dismissCookies(page) {
  try {
    const decline = page.locator('button:has-text("Decline optional cookies")');
    if (await decline.isVisible({ timeout: 2500 })) {
      await decline.click();
      await page.waitForTimeout(800);
    }
  } catch {
    /* no cookie dialog */
  }
}

/** Extract unique post shortcodes from the current page DOM. */
async function extractShortcodes(page) {
  return page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    const set = new Set();
    for (const link of links) {
      const m = link.href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
      if (m) set.add(m[1]);
    }
    return [...set];
  });
}

/**
 * Enumerate all post shortcodes from the profile, clicking "Show more posts"
 * until the grid is fully loaded.
 */
async function enumerateShortcodes(page) {
  await page.goto(IG_PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  await dismissCookies(page);
  await page
    .waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 15000 })
    .catch(() => {});

  let shortcodes = await extractShortcodes(page);
  let clicks = 0;
  while (clicks < 12) {
    const btn = page.locator('button:has-text("Show more posts")');
    let visible = false;
    try {
      visible = await btn.isVisible({ timeout: 2000 });
    } catch {
      visible = false;
    }
    if (!visible) break;
    await btn.click();
    await page.waitForTimeout(2500);
    const next = await extractShortcodes(page);
    if (next.length <= shortcodes.length) break;
    shortcodes = next;
    clicks++;
  }
  return shortcodes;
}

/**
 * Read post metadata from the current post page.
 *
 * Caption: the og:description meta tag is truncated (~400 chars), so we first
 * try to find the FULL caption in the rendered DOM (the smallest element whose
 * text starts with the og:description caption prefix). Falls back to the
 * og:description / og:title caption if the DOM lookup fails.
 * Date + image: from the og: meta tags (server-rendered, reliable).
 *
 * @returns {Promise<{caption: string, date: string|null, imageUrl: string|null}>}
 */
async function readPostMeta(page) {
  return page.evaluate(() => {
    const get = (prop) => {
      const el =
        document.querySelector(`meta[property="${prop}"]`) ||
        document.querySelector(`meta[name="${prop}"]`);
      return el ? el.getAttribute('content') || '' : '';
    };
    const ogImage = get('og:image');
    const ogDesc = get('og:description');
    const ogTitle = get('og:title');

    // Date from og:description: "... on August 18, 2026: \"caption\""
    let date = null;
    if (ogDesc) {
      const dateMatch = ogDesc.match(/on\s+([A-Z][a-z]+ \d{1,2}, \d{4})/);
      if (dateMatch) {
        const d = new Date(dateMatch[1]);
        if (!isNaN(d.getTime())) date = d.toISOString();
      }
    }

    // Caption prefix from og:description (truncated but gives us a start anchor).
    let ogCaption = '';
    if (ogDesc) {
      const capMatch = ogDesc.match(/:\s*"(.*)"\s*\.?\s*$/s);
      if (capMatch) ogCaption = capMatch[1].trim();
    }
    if (!ogCaption && ogTitle) {
      const capMatch = ogTitle.match(/:\s*"(.*)"\s*$/s);
      if (capMatch) ogCaption = capMatch[1].trim();
    }

    // Try to find the FULL caption in the DOM: the smallest element whose
    // innerText starts with the og caption prefix.
    let fullCaption = ogCaption;
    if (ogCaption.length >= 10) {
      const startText = ogCaption.slice(0, 25);
      const all = document.querySelectorAll('div, span, p');
      let best = null;
      for (const el of all) {
        const t = (el.innerText || '').trim();
        if (t.length >= startText.length && t.startsWith(startText)) {
          if (!best || t.length < best.length) best = t;
        }
      }
      if (best && best.length > ogCaption.length) fullCaption = best;
    }

    return { caption: fullCaption, date, imageUrl: ogImage || null };
  });
}

/**
 * Fetch all posts from the Instagram profile.
 * @returns {Promise<Array<{shortcode, postUrl, caption, date, imageUrl}>>}
 */
async function fetchAllPosts() {
  const { browser, context } = await launchContext();
  try {
    const page = await context.newPage();
    const shortcodes = await enumerateShortcodes(page);
    console.log(`[instagram] Found ${shortcodes.length} posts on @${IG_USERNAME}`);

    const posts = [];
    for (const shortcode of shortcodes) {
      const postUrl = `https://www.instagram.com/p/${shortcode}/`;
      try {
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        const meta = await readPostMeta(page);
        posts.push({ shortcode, postUrl, ...meta });
      } catch (err) {
        console.error(`[instagram] Failed to read post ${shortcode}:`, err.message);
      }
      // Be polite between post pages.
      await new Promise((r) => setTimeout(r, 800));
    }
    return posts;
  } finally {
    await browser.close();
  }
}

/**
 * Download an image from a URL, optimize it with sharp, and save locally.
 * @param {string} imageUrl - CDN URL (may expire)
 * @returns {Promise<string>} local URL path, e.g. /uploads/announcements/xxx.webp
 */
async function downloadImageLocally(imageUrl) {
  const resp = await fetch(imageUrl, {
    headers: { 'User-Agent': BROWSER_UA },
  });
  if (!resp.ok) throw new Error(`Image download failed: HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
  const target = path.join(UPLOADS_DIR, filename);

  await sharp(buffer)
    .rotate()
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(target);

  return `/uploads/announcements/${filename}`;
}

module.exports = { fetchAllPosts, downloadImageLocally, UPLOADS_DIR };
