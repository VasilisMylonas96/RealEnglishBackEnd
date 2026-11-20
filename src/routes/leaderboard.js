const express = require('express');
const { Prisma, PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month > 9 || (month === 9 && day >= 11)) {
    return `${date.getFullYear()}-${date.getFullYear() + 1}`;
  }
  return `${date.getFullYear() - 1}-${date.getFullYear()}`;
}

// ─── GET /api/leaderboard/rankings/:type?page=1 ────────────────────────────
// Paged student rankings for daily and weekly points.
router.get('/rankings/:type', requireAuth, async (req, res) => {
  try {
    const { type } = req.params;
    if (!['daily', 'weekly'].includes(type)) {
      return res.status(400).json({ error: 'Ranking type must be daily or weekly' });
    }

    const requestedPage = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      return res.status(400).json({ error: 'Page must be a positive integer' });
    }

    const academicYear = getAcademicYear();
    const pointsField = type === 'daily' ? 'dailyPoints' : 'weeklyPoints';
    const pointsColumn = Prisma.raw(`"${pointsField}"`);
    const pageSize = 20;
    const counts = await prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*) AS "totalEntries"
      FROM "LeaderboardEntry" AS entry
      INNER JOIN "User" AS user ON user.id = entry."userId"
      WHERE entry."academicYear" = ${academicYear}
        AND user.role = 'STUDENT'
    `);
    const totalEntries = Number(counts[0].totalEntries);
    const totalPages = Math.ceil(totalEntries / pageSize);
    const page = Math.min(requestedPage, Math.max(totalPages, 1));
    const offset = (page - 1) * pageSize;

    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT
        entry.id AS "entryId",
        entry."userId" AS "userId",
        entry."totalPoints" AS "totalPoints",
        entry."dailyPoints" AS "dailyPoints",
        entry."weeklyPoints" AS "weeklyPoints",
        user."firstName" AS "firstName",
        user."lastName" AS "lastName",
        user.username AS "username",
        user.level AS "level",
        user."avatarUrl" AS "avatarUrl"
      FROM "LeaderboardEntry" AS entry
      INNER JOIN "User" AS user ON user.id = entry."userId"
      WHERE entry."academicYear" = ${academicYear}
        AND user.role = 'STUDENT'
      ORDER BY entry.${pointsColumn} DESC, entry."totalPoints" DESC, user.id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    res.json({
      type,
      academicYear,
      page,
      pageSize,
      totalEntries,
      totalPages,
      entries: rows.map((row, index) => ({
        rank: offset + index + 1,
        totalPoints: row.totalPoints,
        dailyPoints: row.dailyPoints,
        weeklyPoints: row.weeklyPoints,
        user: {
          id: row.userId,
          firstName: row.firstName,
          lastName: row.lastName,
          username: row.username,
          level: row.level,
          avatarUrl: row.avatarUrl,
        },
      })),
    });
  } catch (err) {
    console.error('Paged leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard page' });
  }
});

// ─── GET /api/leaderboard ───────────────────────────────────────────────────
// Global leaderboard for the current academic year.
// Students see student rankings; teachers/admins see all.
router.get('/', requireAuth, async (req, res) => {
  try {
    const academicYear = getAcademicYear();

    const entries = await prisma.leaderboardEntry.findMany({
      where: { academicYear },
      orderBy: { totalPoints: 'desc' },
      take: 100,
    });

    // Fetch user details
    const userIds = entries.map((e) => e.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, username: true, level: true, role: true, avatarUrl: true },
    });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    // Separate students from staff
    const studentEntries = entries
      .filter((e) => userMap[e.userId]?.role === 'STUDENT')
      .map((e, i) => ({
        rank: i + 1,
        user: userMap[e.userId],
        totalPoints: e.totalPoints,
        dailyPoints: e.dailyPoints,
        weeklyPoints: e.weeklyPoints,
      }));

    const staffEntries = entries
      .filter((e) => userMap[e.userId]?.role !== 'STUDENT')
      .map((e, i) => ({
        rank: i + 1,
        user: userMap[e.userId],
        totalPoints: e.totalPoints,
        dailyPoints: e.dailyPoints,
        weeklyPoints: e.weeklyPoints,
      }));

    res.json({
      academicYear,
      students: studentEntries,
      staff: staffEntries,
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ─── GET /api/leaderboard/hall-of-fame ──────────────────────────────────────
// Historical champions across all academic years.
router.get('/hall-of-fame', requireAuth, async (req, res) => {
  try {
    const records = await prisma.hallOfFame.findMany({
      orderBy: [{ academicYear: 'desc' }, { category: 'asc' }],
    });

    const userIds = [...new Set(records.map((r) => r.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, username: true, level: true, avatarUrl: true },
    });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const grouped = {};
    for (const r of records) {
      const key = `${r.category}-${r.academicYear}`;
      if (!grouped[key]) grouped[key] = { category: r.category, academicYear: r.academicYear, entries: [] };
      grouped[key].entries.push({
        user: userMap[r.userId],
        totalPoints: r.totalPoints,
      });
    }

    res.json({
      hallOfFame: Object.values(grouped),
    });
  } catch (err) {
    console.error('Hall of fame error:', err);
    res.status(500).json({ error: 'Failed to fetch hall of fame' });
  }
});

module.exports = router;
