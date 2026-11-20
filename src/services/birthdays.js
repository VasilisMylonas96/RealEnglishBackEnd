const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Birthday notification service.
 *
 * Runs on startup and every 30 minutes. For every user whose birthday is
 * today (birthDate month/day matches), it creates a BIRTHDAY notification
 * for:
 *   - every TEACHER and ADMIN, and
 *   - every student who has an ACCEPTED friendship with the birthday user.
 *
 * Idempotency: a marker row in PageContents (page_key='system',
 * element_id=`birthday_run_${year}-${month}-${day}`) stores the JSON list of
 * user ids already notified for today, so re-runs on the same day never
 * duplicate notifications.
 */

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Age the user turns on their birthday this year (null if birth year unknown). */
function ageTurning(birthDate, today = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  // birthDate is stored as UTC midnight of the calendar date, so read the
  // year in UTC to avoid off-by-one in timezones behind UTC.
  let age = today.getFullYear() - b.getUTCFullYear();
  if (age < 0) age = null;
  return age;
}

/**
 * Find all users whose birthday is today.
 *
 * birthDate is stored as UTC midnight of the calendar date the user entered
 * (the frontend sends a date-only string, parsed as UTC). We therefore read
 * the birth month/day in UTC, and compare against the server's local
 * calendar date for "today". This is correct regardless of the server's
 * timezone.
 */
async function findBirthdayUsers(today = new Date()) {
  const users = await prisma.user.findMany({
    where: { birthDate: { not: null } },
    select: { id: true, firstName: true, lastName: true, birthDate: true },
  });
  return users.filter((u) => {
    const b = new Date(u.birthDate);
    return b.getUTCMonth() === today.getMonth() && b.getUTCDate() === today.getDate();
  });
}

/** Recipients for a birthday user: teachers/admins + accepted friends. */
async function findRecipients(birthdayUserId) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ['TEACHER', 'ADMIN'] } },
    select: { id: true },
  });

  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: birthdayUserId }, { addresseeId: birthdayUserId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = friendships.map((f) =>
    f.requesterId === birthdayUserId ? f.addresseeId : f.requesterId
  );

  const ids = new Set(staff.map((s) => s.id));
  friendIds.forEach((id) => ids.add(id));
  ids.delete(birthdayUserId); // never notify the birthday user about themselves
  return [...ids];
}

async function readMarker(dateKey) {
  const row = await prisma.pageContents.findUnique({
    where: { page_key_element_id: { page_key: 'system', element_id: `birthday_run_${dateKey}` } },
  });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeMarker(dateKey, notifiedIds) {
  await prisma.pageContents.upsert({
    where: { page_key_element_id: { page_key: 'system', element_id: `birthday_run_${dateKey}` } },
    update: { content: JSON.stringify(notifiedIds) },
    create: { page_key: 'system', element_id: `birthday_run_${dateKey}`, content: JSON.stringify(notifiedIds) },
  });
}

/**
 * Run the birthday check. Returns the number of notifications created.
 */
async function runBirthdayCheck(today = new Date()) {
  const dateKey = localDateKey(today);
  const birthdayUsers = await findBirthdayUsers(today);
  if (birthdayUsers.length === 0) return 0;

  const alreadyNotified = new Set(await readMarker(dateKey));
  let created = 0;

  for (const user of birthdayUsers) {
    if (alreadyNotified.has(user.id)) continue;

    const age = ageTurning(user.birthDate, today);
    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
    const birthYear = new Date(user.birthDate).getUTCFullYear();
    const ageText = age !== null ? ` κλείνει τα ${age}!` : '';
    const yearText = birthYear ? ` (γενν. ${birthYear})` : '';

    const recipients = await findRecipients(user.id);
    if (recipients.length === 0) {
      // Nothing to notify, but mark as processed so we don't re-scan forever.
      alreadyNotified.add(user.id);
      continue;
    }

    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        title: '🎂 Γενέθλια',
        message: `${name} έχει γενέθλια σήμερα${yearText}${ageText}`,
        type: 'BIRTHDAY',
        linkUrl: `/birthday/${user.id}`,
      })),
    });
    created += recipients.length;
    alreadyNotified.add(user.id);
  }

  if (birthdayUsers.length > 0) {
    await writeMarker(dateKey, [...alreadyNotified]);
  }

  if (created > 0) {
    console.log(`[birthdays] Created ${created} birthday notification(s).`);
  }
  return created;
}

/**
 * Startup + interval guard. Call once at boot; the interval keeps it fresh
 * (covers servers that were down at midnight).
 */
function startBirthdayScheduler() {
  runBirthdayCheck().catch((err) => {
    console.error('Birthday check failed:', err.message);
  });
  const interval = setInterval(() => {
    runBirthdayCheck().catch((err) => {
      console.error('Birthday check failed:', err.message);
    });
  }, 30 * 60 * 1000);
  // Don't keep the process alive just for this timer.
  if (typeof interval.unref === 'function') interval.unref();
  return interval;
}

module.exports = { runBirthdayCheck, startBirthdayScheduler, ageTurning };
