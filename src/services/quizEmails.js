const prisma = require('../prisma');
const { sendDailyQuizEmail, sendWeeklyQuizEmail, sendTournamentReminderEmail } = require('./email');

/**
 * Daily / weekly quiz email scheduler + tournament "starts soon" reminders.
 *
 * Runs on startup and every 30 minutes (same pattern as the birthday
 * scheduler). Each run:
 *   - sends the DAILY quiz reminder to every student with an email address
 *     (once per calendar day, at/after 08:00 local time), and
 *   - on Fridays, also sends the WEEKLY quiz reminder (once per week), and
 *   - sends a "starts in ~1 hour" reminder to every participant of a
 *     SCHEDULED tournament whose start time is within the next 60 minutes
 *     (once per tournament per participant).
 *
 * Idempotency: marker rows in PageContents (page_key='system',
 * element_id=`quiz_email_${type}_${dateKey}`) store the JSON list of user
 * ids already emailed, so re-runs on the same day/week never duplicate.
 */

const QUIZ_EMAIL_HOUR = 8; // send daily/weekly quiz emails at/after 08:00 local

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
function weekKey(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return localDateKey(d);
}

async function readMarker(elementId) {
  const row = await prisma.pageContents.findUnique({
    where: { page_key_element_id: { page_key: 'system', element_id: elementId } },
  });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeMarker(elementId, userIds) {
  await prisma.pageContents.upsert({
    where: { page_key_element_id: { page_key: 'system', element_id: elementId } },
    update: { content: JSON.stringify(userIds) },
    create: { page_key: 'system', element_id: elementId, content: JSON.stringify(userIds) },
  });
}

/**
 * Send one quiz email type to all eligible students not yet marked.
 * @param {string} elementId - marker element id (per day / per week)
 * @param {Function} sendFn - (email, user) => Promise<{sent, reason?}>
 * @param {Set<string>} [skipUserIds] - students who already completed the quiz
 */
async function sendQuizEmails(elementId, sendFn, skipUserIds = new Set()) {
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', email: { not: null } },
    select: { id: true, firstName: true, username: true, email: true },
  });
  if (students.length === 0) return 0;

  const alreadySent = new Set(await readMarker(elementId));
  let sent = 0;

  for (const student of students) {
    if (alreadySent.has(student.id) || skipUserIds.has(student.id)) continue;
    const outcome = await sendFn(student.email, student);
    if (outcome.sent) {
      alreadySent.add(student.id);
      sent += 1;
    }
  }

  await writeMarker(elementId, [...alreadySent]);
  return sent;
}

/**
 * Send "starts in ~1 hour" reminders for SCHEDULED tournaments whose start
 * time is within the next 60 minutes. Idempotent per tournament+participant.
 */
async function sendTournamentReminders(now = new Date()) {
  const windowStart = new Date(now.getTime() - 5 * 60 * 1000); // tolerate a few min drift
  const windowEnd = new Date(now.getTime() + 60 * 60 * 1000);

  const tournaments = await prisma.tournament.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { gte: windowStart, lte: windowEnd } },
    select: {
      id: true,
      name: true,
      scheduledAt: true,
      durationMin: true,
      finalDurationMin: true,
    },
  });
  if (tournaments.length === 0) return 0;

  let sent = 0;
  for (const tournament of tournaments) {
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id },
      select: { userId: true },
    });
    if (participants.length === 0) continue;

    const users = await prisma.user.findMany({
      where: { id: { in: participants.map((p) => p.userId) }, email: { not: null } },
      select: { id: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const markerId = `tournament_reminder_${tournament.id}`;
    const alreadySent = new Set(await readMarker(markerId));

    for (const p of participants) {
      const user = userMap.get(p.userId);
      if (!user || alreadySent.has(user.id)) continue;
      const outcome = await sendTournamentReminderEmail(user.email, {
        name: tournament.name,
        scheduledAt: tournament.scheduledAt,
        durationMin: tournament.durationMin,
        finalDurationMin: tournament.finalDurationMin,
      });
      if (outcome.sent) {
        alreadySent.add(user.id);
        sent += 1;
      }
    }
    await writeMarker(markerId, [...alreadySent]);
  }
  return sent;
}

/**
 * Run the quiz email check. Returns { daily, weekly, tournament } send counts.
 */
async function runQuizEmailCheck(today = new Date()) {
  const dayKey = localDateKey(today);
  const wkKey = weekKey(today);

  // Students who already completed the daily quiz today / weekly quiz this
  // week don't need a reminder.
  const dayStart = new Date(`${dayKey}T00:00:00`);
  const weekStart = new Date(`${wkKey}T00:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [dailyDone, weeklyDone] = await Promise.all([
    prisma.quizAttempt.findMany({
      where: { quizType: 'DAILY', completedAt: { gte: dayStart } },
      select: { userId: true },
    }),
    prisma.quizAttempt.findMany({
      where: { quizType: 'WEEKLY', completedAt: { gte: weekStart, lt: weekEnd } },
      select: { userId: true },
    }),
  ]);

  // Daily/weekly quiz emails only go out at/after 08:00 local time.
  let dailySent = 0;
  let weeklySent = 0;
  if (today.getHours() >= QUIZ_EMAIL_HOUR) {
    dailySent = await sendQuizEmails(
      `quiz_email_daily_${dayKey}`,
      sendDailyQuizEmail,
      new Set(dailyDone.map((a) => a.userId))
    );

    if (today.getDay() === 5) {
      weeklySent = await sendQuizEmails(
        `quiz_email_weekly_${wkKey}`,
        sendWeeklyQuizEmail,
        new Set(weeklyDone.map((a) => a.userId))
      );
    }
  }

  const tournamentSent = await sendTournamentReminders(today);

  if (dailySent > 0 || weeklySent > 0 || tournamentSent > 0) {
    console.log(
      `[quiz-emails] Sent ${dailySent} daily / ${weeklySent} weekly / ${tournamentSent} tournament reminder email(s).`
    );
  }
  return { daily: dailySent, weekly: weeklySent, tournament: tournamentSent };
}

/**
 * Startup + interval guard. Call once at boot; the interval keeps it fresh
 * (covers servers that were down at the send time).
 */
function startQuizEmailScheduler() {
  runQuizEmailCheck().catch((err) => {
    console.error('Quiz email check failed:', err.message);
  });
  const interval = setInterval(() => {
    runQuizEmailCheck().catch((err) => {
      console.error('Quiz email check failed:', err.message);
    });
  }, 30 * 60 * 1000);
  if (typeof interval.unref === 'function') interval.unref();
  return interval;
}

module.exports = { runQuizEmailCheck, startQuizEmailScheduler };
