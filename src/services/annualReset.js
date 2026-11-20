const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Annual reset & Hall of Fame service.
 *
 * Per the specification:
 *  - All competitive points reset every year on September 23rd.
 *  - Before resetting, the top daily and weekly champions of the ending
 *    academic year are recorded in the Hall of Fame (permanent archive).
 *
 * The academic year in this codebase runs Sep 11 → Sep 10. The reset date
 * (Sep 23) falls inside the new academic year, so we treat "the year that
 * just ended" as the one whose points we archive, then clear the current
 * year's running totals so the new year starts fresh.
 */

const RESET_MONTH = 8; // September (0-based)
const RESET_DAY = 23;

function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month > 9 || (month === 9 && day >= 11)) {
    return `${date.getFullYear()}-${date.getFullYear() + 1}`;
  }
  return `${date.getFullYear() - 1}-${date.getFullYear()}`;
}

/**
 * Returns true if today is on or after the annual reset date
 * (Sep 23) within the current calendar year.
 */
function isResetDue(date = new Date()) {
  if (date.getMonth() !== RESET_MONTH) return false;
  return date.getDate() >= RESET_DAY;
}

/**
 * Record the top daily and weekly champions for a given academic year
 * into the Hall of Fame (idempotent — skips already-recorded users).
 */
async function recordHallOfFame(academicYear) {
  const entries = await prisma.leaderboardEntry.findMany({
    where: { academicYear },
    orderBy: [{ totalPoints: 'desc' }],
  });

  if (entries.length === 0) return { recorded: 0 };

  // Top daily champion (highest dailyPoints)
  const byDaily = [...entries].sort((a, b) => b.dailyPoints - a.dailyPoints);
  const dailyChampion = byDaily.find((e) => e.dailyPoints > 0);

  // Top weekly champion (highest weeklyPoints)
  const byWeekly = [...entries].sort((a, b) => b.weeklyPoints - a.weeklyPoints);
  const weeklyChampion = byWeekly.find((e) => e.weeklyPoints > 0);

  let recorded = 0;

  if (dailyChampion) {
    await prisma.hallOfFame.upsert({
      where: {
        userId_category_academicYear: {
          userId: dailyChampion.userId,
          category: 'DAILY',
          academicYear,
        },
      },
      update: { totalPoints: dailyChampion.dailyPoints },
      create: {
        userId: dailyChampion.userId,
        category: 'DAILY',
        academicYear,
        totalPoints: dailyChampion.dailyPoints,
      },
    });
    recorded++;
  }

  if (weeklyChampion) {
    await prisma.hallOfFame.upsert({
      where: {
        userId_category_academicYear: {
          userId: weeklyChampion.userId,
          category: 'WEEKLY',
          academicYear,
        },
      },
      update: { totalPoints: weeklyChampion.weeklyPoints },
      create: {
        userId: weeklyChampion.userId,
        category: 'WEEKLY',
        academicYear,
        totalPoints: weeklyChampion.weeklyPoints,
      },
    });
    recorded++;
  }

  return { recorded };
}

/**
 * Reset all competitive points for a given academic year to zero.
 */
async function resetPoints(academicYear) {
  const result = await prisma.leaderboardEntry.updateMany({
    where: { academicYear },
    data: { totalPoints: 0, dailyPoints: 0, weeklyPoints: 0 },
  });
  return { reset: result.count };
}

/**
 * Run the full annual reset cycle:
 *  1. Archive the ending year's champions to the Hall of Fame.
 *  2. Zero out the current year's running totals.
 *
 * @returns {Promise<{year: string, hallOfFame: number, reset: number}>}
 */
async function runAnnualReset() {
  const now = new Date();
  const currentYear = getAcademicYear(now);

  // Archive champions for the year that is ending (the previous academic year).
  const [startYear, endYear] = currentYear.split('-').map(Number);
  const previousYear = `${startYear - 1}-${endYear - 1}`;

  const hof = await recordHallOfFame(previousYear);
  const reset = await resetPoints(currentYear);

  console.log(
    `[annual-reset] Archived ${hof.recorded} champion(s) for ${previousYear}; ` +
    `reset ${reset.reset} leaderboard entr(ies) for ${currentYear}.`
  );

  return { year: currentYear, hallOfFame: hof.recorded, reset: reset.reset };
}

/**
 * Startup guard: if the reset date has passed this calendar year and the
 * reset hasn't been applied yet, run it. Uses a marker row in a lightweight
 * table-free approach: we check whether the current year's entries are all
 * zero AND the previous year's champions are already in the Hall of Fame.
 *
 * To keep this simple and idempotent without an extra table, we rely on the
 * fact that resetPoints is idempotent (setting zeros again is harmless) and
 * recordHallOfFame is idempotent (upsert). We gate on a marker stored in
 * PageContents to avoid re-logging every boot.
 */
async function maybeRunAnnualResetOnStartup() {
  if (!isResetDue()) return;

  const markerKey = 'annual_reset_done';
  const now = new Date();
  const markerValue = `${now.getFullYear()}`;

  const existing = await prisma.pageContents.findUnique({
    where: { page_key_element_id: { page_key: 'system', element_id: markerKey } },
  });

  if (existing && existing.content === markerValue) {
    return; // Already ran this calendar year.
  }

  await runAnnualReset();

  await prisma.pageContents.upsert({
    where: { page_key_element_id: { page_key: 'system', element_id: markerKey } },
    update: { content: markerValue },
    create: {
      page_key: 'system',
      element_id: markerKey,
      content: markerValue,
    },
  });
}

module.exports = {
  getAcademicYear,
  isResetDue,
  recordHallOfFame,
  resetPoints,
  runAnnualReset,
  maybeRunAnnualResetOnStartup,
};
