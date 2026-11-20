/**
 * Shared URL helpers.
 *
 * Every absolute URL the backend builds (invite emails, video call join
 * links, media URLs) must resolve correctly in local dev AND in production
 * without code changes. The strategy:
 *
 *   1. Use the configured env var (APP_BASE_URL / PUBLIC_BASE_URL) when set.
 *   2. Otherwise derive the URL from the incoming request's Host header,
 *      which is always correct behind a reverse proxy / on any domain.
 *
 * This means the .env files only need the env vars for local development;
 * in production the Host header fallback makes them optional.
 */

/**
 * Frontend base URL (where the React app is served).
 * Used to build video call join links and invite URLs.
 */
function appBaseUrl(req) {
  // 1. FRONTEND_URL (explicit, no trailing slash) — preferred in production.
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  if (frontendUrl) return frontendUrl;

  // 2. Request Origin (if it matches a CORS-allowed origin).
  const requestOrigin = req?.get?.('origin');
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''));
  if (requestOrigin && allowedOrigins.includes(requestOrigin.replace(/\/$/, ''))) {
    return requestOrigin.replace(/\/$/, '');
  }

  // 3. APP_BASE_URL (legacy).
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');

  // 4. Derive from request Host header.
  const host = req?.get?.('host') || 'localhost:3000';
  const proto = req?.get?.('x-forwarded-proto') || req?.protocol || 'http';
  return `${proto}://${host}`;
}

/**
 * Backend base URL (where the API + uploads are served).
 * Used to build absolute media/attachment URLs.
 */
function publicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = req?.get?.('host') || 'localhost:4000';
  const proto = req?.get?.('x-forwarded-proto') || req?.protocol || 'http';
  return `${proto}://${host}`;
}

/**
 * Convert an absolute URL to a relative path (pathname + search + hash).
 * Used to store SPA-navigable linkUrl values in notifications.
 */
function toRelativePath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return url; // already relative or unparseable — keep as-is
  }
}

module.exports = { appBaseUrl, publicBaseUrl, toRelativePath };
