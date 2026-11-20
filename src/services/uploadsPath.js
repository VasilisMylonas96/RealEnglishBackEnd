/**
 * Shared uploads-directory helper.
 *
 * The uploads folder is resolved from the UPLOADS_DIR environment variable
 * when set (useful on a server where media lives outside the repo), and
 * otherwise falls back to the default <project>/uploads folder next to the
 * source tree. This keeps local development zero-config while allowing the
 * production deployment to point media storage anywhere.
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

/**
 * Resolve the base uploads directory, creating it if it does not exist.
 * @returns {string} absolute path to the uploads directory
 */
function getUploadsDir() {
  const dir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : DEFAULT_UPLOADS_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a sub-directory of uploads (e.g. 'announcements', 'extraction'),
 * creating it if it does not exist.
 * @param {string} sub relative sub-path under uploads
 * @returns {string} absolute path to the sub-directory
 */
function getUploadsSubDir(sub) {
  const dir = path.join(getUploadsDir(), sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { getUploadsDir, getUploadsSubDir };
