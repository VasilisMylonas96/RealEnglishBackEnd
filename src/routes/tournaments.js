const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const { pickRandomQuestions } = require('../services/questionPicker');
const { selectBalancedQuizQuestions } = require('../services/balancedQuizQuestions');
const { parseQuestionData, isQuestionAnswerCorrect } = require('../services/questionAnswers');
const { sendTournamentEmail } = require('../services/email');

const router = express.Router();
const prisma = new PrismaClient();

const LEVELS = ['A-Junior', 'B-Junior', 'A-Senior', 'B-Senior', 'C-Junior', 'C-Senior'];
const LEVEL_INDEX = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

// 5-minute window to start a match after scheduled time
const START_WINDOW_SEC = 5 * 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAcademicYear(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month > 9 || (month === 9 && day >= 11)) {
    return `${date.getFullYear()}-${date.getFullYear() + 1}`;
  }
  return `${date.getFullYear() - 1}-${date.getFullYear()}`;
}

/**
 * Generate a tier-balanced single-elimination bracket.
 * Participants are grouped by level, then interleaved so that
 * opponents in early rounds are within MAX_LEVEL_VARIANCE of each other.
 * Returns an array of TournamentMatch data objects.
 */
function generateBracket(participants) {
  // Pair adjacent levels so early-round opponents differ by at most one tier.
  const sorted = [...participants].sort((a, b) => {
    const la = LEVEL_INDEX[a.level] || 0;
    const lb = LEVEL_INDEX[b.level] || 0;
    return la - lb || a.id.localeCompare(b.id);
  });

  // Minimal byes: only 0 or 1 bye per round (not padding to power of 2).
  // Odd count → 1 bye (given to the lowest-seeded player); even → 0 byes.
  const byeCount = sorted.length % 2;
  const matchCount = Math.floor(sorted.length / 2);
  const matches = [];
  let participantIndex = 0;

  for (let position = 0; position < matchCount; position++) {
    const participantA = sorted[participantIndex++];
    const participantB = sorted[participantIndex++];

    matches.push({
      round: 1,
      position,
      participantAId: participantA.id,
      participantBId: participantB.id,
      winnerId: null,
      status: 'PENDING',
    });
  }

  // If odd, the last (lowest-seeded) player gets a bye and advances automatically.
  if (byeCount > 0) {
    const byePlayer = sorted[participantIndex];
    matches.push({
      round: 1,
      position: matchCount,
      participantAId: byePlayer.id,
      participantBId: null,
      winnerId: byePlayer.id,
      status: 'BYE',
    });
  }

  return { matches };
}

/**
 * Create the next round only after every match in the current round resolves.
 */
function advanceBracket(tournamentId, currentMatches) {
  if (currentMatches.length === 0) return [];

  const rounds = {};
  for (const match of currentMatches) {
    if (!rounds[match.round]) rounds[match.round] = [];
    rounds[match.round].push(match);
  }

  const latestRound = Math.max(...Object.keys(rounds).map(Number));
  const roundMatches = rounds[latestRound];
  if (roundMatches.some((match) => !['COMPLETED', 'BYE'].includes(match.status))) return [];

  const winners = roundMatches
    .sort((a, b) => a.position - b.position)
    .map((match) => match.winnerId);
  if (winners.length <= 1 || winners.some((winnerId) => !winnerId)) return [];

  const nextRound = latestRound + 1;
  const matchCount = Math.floor(winners.length / 2);
  const nextMatches = [];

  for (let position = 0; position < matchCount; position++) {
    nextMatches.push({
      tournamentId,
      round: nextRound,
      position,
      participantAId: winners[position * 2],
      participantBId: winners[position * 2 + 1],
      winnerId: null,
      status: 'PENDING',
    });
  }

  // Odd number of winners → the last winner gets a bye and advances automatically.
  if (winners.length % 2 === 1) {
    const byeWinner = winners[matchCount * 2];
    nextMatches.push({
      tournamentId,
      round: nextRound,
      position: matchCount,
      participantAId: byeWinner,
      participantBId: null,
      winnerId: byeWinner,
      status: 'BYE',
    });
  }

  return nextMatches;
}

async function createTieBreaker(prismaClient, match, participantA, participantB, round) {
  const usedQuestions = await prismaClient.tournamentTieBreaker.findMany({
    where: { matchId: match.id },
    select: { questionId: true },
  });
  const questionIds = usedQuestions.map((item) => item.questionId);
  const levels = [...new Set([participantA.level, participantB.level])]
    .flatMap((level) => {
      const index = LEVEL_INDEX[level] ?? 0;
      return LEVELS.filter((_, candidateIndex) => Math.abs(candidateIndex - index) <= 2);
    });
  const difficulty = ['easy', 'medium', 'hard'][(round - 1) % 3];
  let [question] = await pickRandomQuestions(prismaClient, {
    levels: [...new Set(levels)],
    difficulty,
    count: 1,
    excludeIds: questionIds,
  });

  if (!question) {
    [question] = await pickRandomQuestions(prismaClient, {
      levels: [...new Set(levels)],
      difficulty,
      count: 1,
    });
  }
  if (!question) {
    throw new Error(`No ${difficulty} question available for tournament tie-breaker`);
  }

  return prismaClient.tournamentTieBreaker.create({
    data: { matchId: match.id, round, questionId: question.id },
  });
}

/**
 * Forfeit: the start window (5 min after scheduled time) has passed and the
 * player never started the match.
 *  - Opponent already started → opponent wins, absent player is eliminated.
 *  - Opponent also absent → both are eliminated; the match is still resolved
 *    with a winner (participant A) so the bracket can keep advancing.
 */
async function applyForfeit(prismaClient, tournament, match, absentSide) {
  const isA = absentSide === 'A';
  const absentId = isA ? match.participantAId : match.participantBId;
  const presentId = isA ? match.participantBId : match.participantAId;
  const presentStarted = isA ? match.participantBStartedAt : match.participantAStartedAt;

  const winnerId = presentId && presentStarted ? presentId : absentId;
  const loserId = presentId && presentStarted ? absentId : presentId;

  await prismaClient.tournamentParticipant.update({
    where: { id: absentId },
    data: { isEliminated: true },
  });
  if (!presentStarted && loserId) {
    // Both absent: both lose.
    await prismaClient.tournamentParticipant.update({
      where: { id: loserId },
      data: { isEliminated: true },
    });
  }

  await resolveCompletedMatch(prismaClient, tournament.id, match.id, winnerId, loserId);
}

// Periodic sweeper: applies forfeits for matches whose start window has
// passed. Runs every 30 s so the bracket advances even if no client polls.
let forfeitSweeperStarted = false;
function startForfeitSweeper() {
  if (forfeitSweeperStarted) return;
  forfeitSweeperStarted = true;
  const sweep = async () => {
    try {
      const activeTournaments = await prisma.tournament.findMany({
        where: { status: 'ACTIVE' },
      });
      const now = new Date();
      for (const tournament of activeTournaments) {
        const scheduled = new Date(tournament.scheduledAt);
        if ((now - scheduled) / 1000 <= START_WINDOW_SEC) continue;
        const matches = await prisma.tournamentMatch.findMany({
          where: { tournamentId: tournament.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        });
        for (const match of matches) {
          const aStarted = Boolean(match.participantAStartedAt);
          const bStarted = Boolean(match.participantBStartedAt);
          if (aStarted && !bStarted && match.participantBId) {
            await applyForfeit(prisma, tournament, match, 'B');
          } else if (bStarted && !aStarted && match.participantAId) {
            await applyForfeit(prisma, tournament, match, 'A');
          }
        }
      }
    } catch (err) {
      console.error('Forfeit sweeper error:', err.message);
    }
  };
  setInterval(sweep, 30 * 1000).unref();
}

async function resolveCompletedMatch(prismaClient, tournamentId, matchId, winnerId, loserId) {
  if (loserId) {
    await prismaClient.tournamentParticipant.update({
      where: { id: loserId },
      data: { isEliminated: true },
    });
  }
  await prismaClient.tournamentMatch.update({
    where: { id: matchId },
    data: { winnerId, status: 'COMPLETED' },
  });

  const allMatches = await prismaClient.tournamentMatch.findMany({
    where: { tournamentId },
  });
  const newMatches = advanceBracket(tournamentId, allMatches);
  if (newMatches.length > 0) {
    await prismaClient.tournamentMatch.createMany({ data: newMatches });
  }

  const latestRound = Math.max(...allMatches.map((item) => item.round));
  const finalRoundMatches = allMatches.filter((item) => item.round === latestRound);
  if (finalRoundMatches.length === 1 && finalRoundMatches.every((item) => ['COMPLETED', 'BYE'].includes(item.status))) {
    await prismaClient.tournament.update({
      where: { id: tournamentId },
      data: { status: 'COMPLETED' },
    });
  }
}

// ─── POST /api/tournaments ──────────────────────────────────────────────────
// Teacher/Admin: create a new tournament.
router.post('/', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const {
      name,
      scheduledAt,
      durationMin = 15,
      finalDurationMin = 20,
      participantIds = [],
    } = req.body || {};

    if (!name || !scheduledAt) {
      return res.status(400).json({ error: 'name and scheduledAt are required' });
    }
    if (!Number.isInteger(durationMin) || durationMin < 1) {
      return res.status(400).json({ error: 'durationMin must be a positive integer (minutes)' });
    }
    if (!Number.isInteger(finalDurationMin) || finalDurationMin < 1) {
      return res.status(400).json({ error: 'finalDurationMin must be a positive integer (minutes)' });
    }

    const tournament = await prisma.tournament.create({
      data: {
        name,
        scheduledAt: new Date(scheduledAt),
        durationMin,
        finalDurationMin,
        questionCount: 20,
        createdBy: req.user.id,
      },
    });

    // Add participants
    if (participantIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: participantIds }, role: 'STUDENT' },
        select: { id: true, level: true },
      });

      const participants = users.map((u, i) => ({
        tournamentId: tournament.id,
        userId: u.id,
        level: u.level || 'A-Junior',
        bracketPosition: i,
      }));

      await prisma.tournamentParticipant.createMany({ data: participants });
    }

    // Announce the tournament to every participant with an email address.
    const organizerName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.username;
    const emailResults = await emailTournamentParticipants(tournament, organizerName);

    res.status(201).json({ tournament, emailResults });
  } catch (err) {
    console.error('Tournament create error:', err);
    res.status(500).json({ error: 'Failed to create tournament' });
  }
});

// ─── GET /api/tournaments ───────────────────────────────────────────────────
// List tournaments (all roles can see; teachers/admins see all, students see active).
router.get('/', requireAuth, async (req, res) => {
  try {
    // All roles see every tournament: the UI splits "current" (SCHEDULED/ACTIVE)
    // from "history" (anything with a generated bracket, incl. COMPLETED).
    const tournaments = await prisma.tournament.findMany({
      orderBy: { scheduledAt: 'desc' },
      take: 50,
    });

    // Count participants per tournament (no Prisma relation, so count manually).
    const counts = await prisma.tournamentParticipant.groupBy({
      by: ['tournamentId'],
      where: { tournamentId: { in: tournaments.map((t) => t.id) } },
      _count: { _all: true },
    });
    const countMap = Object.fromEntries(counts.map((c) => [c.tournamentId, c._count._all]));

    // Count matches per tournament → hasBracket flag for the history section.
    const matchCounts = await prisma.tournamentMatch.groupBy({
      by: ['tournamentId'],
      where: { tournamentId: { in: tournaments.map((t) => t.id) } },
      _count: { _all: true },
    });
    const matchCountMap = Object.fromEntries(matchCounts.map((c) => [c.tournamentId, c._count._all]));

    res.json({
      tournaments: tournaments.map((t) => ({
        id: t.id,
        name: t.name,
        scheduledAt: t.scheduledAt,
        durationMin: t.durationMin,
        finalDurationMin: t.finalDurationMin,
        status: t.status,
        participantCount: countMap[t.id] || 0,
        hasBracket: (matchCountMap[t.id] || 0) > 0,
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    console.error('Tournament list error:', err);
    res.status(500).json({ error: 'Failed to list tournaments' });
  }
});

// ─── GET /api/tournaments/:id ───────────────────────────────────────────────
// Get tournament details + bracket.
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    // No Prisma relations on Tournament, so fetch participants + matches separately.
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id },
    });
    const matches = await prisma.tournamentMatch.findMany({
      where: { tournamentId: tournament.id },
      orderBy: [{ round: 'asc' }, { position: 'asc' }],
    });
    const tieBreakers = await prisma.tournamentTieBreaker.findMany({
      where: { matchId: { in: matches.map((match) => match.id) } },
      orderBy: { round: 'desc' },
    });
    const latestTieBreakerByMatch = {};
    for (const tieBreaker of tieBreakers) {
      if (!latestTieBreakerByMatch[tieBreaker.matchId]) {
        latestTieBreakerByMatch[tieBreaker.matchId] = tieBreaker;
      }
    }

    const userIds = [...new Set(participants.map((p) => p.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, username: true, level: true, avatarUrl: true },
    });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    // Attach the user object to each participant for the bracket view.
    const participantsWithUser = participants.map((p) => ({ ...p, user: userMap[p.userId] }));

    // Build bracket view
    const participantMap = Object.fromEntries(
      participantsWithUser.map((p) => [p.id, p])
    );

    const bracket = matches.map((m) => ({
      id: m.id,
      round: m.round,
      position: m.position,
      participantA: m.participantAId ? {
        id: m.participantAId,
        score: m.participantAScore ?? (
          m.status === 'COMPLETED' && m.winnerId
            ? participantMap[m.participantAId]?.score ?? null
            : null
        ),
        isEliminated: participantMap[m.participantAId]?.isEliminated ?? false,
        user: participantMap[m.participantAId]?.user,
      } : null,
      participantB: m.participantBId ? {
        id: m.participantBId,
        score: m.participantBScore ?? (
          m.status === 'COMPLETED' && m.winnerId
            ? participantMap[m.participantBId]?.score ?? null
            : null
        ),
        isEliminated: participantMap[m.participantBId]?.isEliminated ?? false,
        user: participantMap[m.participantBId]?.user,
      } : null,
      winnerId: m.winnerId,
      status: m.status,
      participantAStarted: Boolean(m.participantAStartedAt),
      participantBStarted: Boolean(m.participantBStartedAt),
      participantACompleted: Boolean(m.participantACompletedAt),
      participantBCompleted: Boolean(m.participantBCompletedAt),
      tieBreakerRound: latestTieBreakerByMatch[m.id]?.round ?? 0,
      participantATieBreakerAnswered: latestTieBreakerByMatch[m.id]?.participantACompletedAt != null,
      participantBTieBreakerAnswered: latestTieBreakerByMatch[m.id]?.participantBCompletedAt != null,
    }));

    res.json({
      tournament: {
        id: tournament.id,
        name: tournament.name,
        scheduledAt: tournament.scheduledAt,
        durationMin: tournament.durationMin,
        finalDurationMin: tournament.finalDurationMin,
        status: tournament.status,
      },
      participants: participantsWithUser.map((p) => ({
        id: p.id,
        level: p.level,
        score: p.score,
        isEliminated: p.isEliminated,
        startedAt: p.startedAt,
        completedAt: p.completedAt,
        user: p.user,
      })),
      bracket,
    });
  } catch (err) {
    console.error('Tournament detail error:', err);
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
});

/**
 * Send the tournament announcement email to every participant that has an
 * email address. Returns per-recipient outcomes.
 */
async function emailTournamentParticipants(tournament, organizerName) {
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId: tournament.id },
    select: { userId: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: participants.map((p) => p.userId) } },
    select: { id: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));
  const results = [];
  for (const p of participants) {
    const user = userMap.get(p.userId);
    if (!user?.email) {
      results.push({ userId: p.userId, email: null, emailSent: false, reason: 'no_email' });
      continue;
    }
    const outcome = await sendTournamentEmail(user.email, {
      name: tournament.name,
      scheduledAt: tournament.scheduledAt,
      durationMin: tournament.durationMin,
      finalDurationMin: tournament.finalDurationMin,
      organizerName,
    });
    results.push({ userId: p.userId, email: user.email, emailSent: outcome.sent, reason: outcome.sent ? null : outcome.reason });
  }
  return results;
}

// ─── POST /api/tournaments/:id/participants ─────────────────────────────────
// Teacher/Admin: add participants to a tournament.
router.post('/:id/participants', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const { participantIds = [] } = req.body || {};
    if (participantIds.length === 0) {
      return res.status(400).json({ error: 'participantIds is required' });
    }

    const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status !== 'SCHEDULED') {
      return res.status(400).json({ error: 'Can only add participants to scheduled tournaments' });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: participantIds }, role: 'STUDENT' },
      select: { id: true, level: true, email: true },
    });

    // Check for duplicates
    const existing = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id, userId: { in: participantIds } },
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((e) => e.userId));

    const newUsers = users.filter((u) => !existingIds.has(u.id));
    const newParticipants = newUsers.map((u) => ({
      tournamentId: tournament.id,
      userId: u.id,
      level: u.level || 'A-Junior',
    }));

    if (newParticipants.length > 0) {
      await prisma.tournamentParticipant.createMany({ data: newParticipants });
    }

    // Announce the tournament to the newly added participants with emails.
    const organizerName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.username;
    const emailResults = [];
    for (const u of newUsers) {
      if (!u.email) {
        emailResults.push({ userId: u.id, email: null, emailSent: false, reason: 'no_email' });
        continue;
      }
      const outcome = await sendTournamentEmail(u.email, {
        name: tournament.name,
        scheduledAt: tournament.scheduledAt,
        durationMin: tournament.durationMin,
        finalDurationMin: tournament.finalDurationMin,
        organizerName,
      });
      emailResults.push({ userId: u.id, email: u.email, emailSent: outcome.sent, reason: outcome.sent ? null : outcome.reason });
    }

    res.json({ ok: true, added: newParticipants.length, emailResults });
  } catch (err) {
    console.error('Tournament add participants error:', err);
    res.status(500).json({ error: 'Failed to add participants' });
  }
});

// ─── POST /api/tournaments/:id/generate-bracket ─────────────────────────────
// Teacher/Admin: generate the tier-balanced bracket.
router.post('/:id/generate-bracket', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
    });

    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status !== 'SCHEDULED') {
      return res.status(400).json({ error: 'Can only generate bracket for scheduled tournaments' });
    }

    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id },
    });
    if (participants.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 participants' });
    }

    // Delete existing matches (regenerate)
    await prisma.tournamentMatch.deleteMany({ where: { tournamentId: tournament.id } });

    const { matches } = generateBracket(participants);

    await prisma.tournamentMatch.createMany({
      data: matches.map((m) => ({ ...m, tournamentId: tournament.id })),
    });

    // Activate the tournament
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: { status: 'ACTIVE' },
    });

    res.json({ ok: true, matchCount: matches.length });
  } catch (err) {
    console.error('Bracket generation error:', err);
    res.status(500).json({ error: 'Failed to generate bracket' });
  }
});

// ─── POST /api/tournaments/:id/matches/:matchId/start ───────────────────────
// Student: start a match quiz. Enforces 5-minute start window.
router.post('/:id/matches/:matchId/start', requireAuth, async (req, res) => {
  try {
    const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Tournament is not active' });
    }

    const match = await prisma.tournamentMatch.findUnique({ where: { id: req.params.matchId } });
    if (!match || match.tournamentId !== tournament.id) {
      return res.status(404).json({ error: 'Match not found' });
    }
    if (['COMPLETED', 'BYE'].includes(match.status)) {
      return res.status(400).json({ error: 'Match already completed' });
    }

    const matchParticipants = await prisma.tournamentParticipant.findMany({
      where: {
        id: { in: [match.participantAId, match.participantBId].filter(Boolean) },
      },
    });
    const participantA = matchParticipants.find((p) => p.id === match.participantAId);
    const participantB = matchParticipants.find((p) => p.id === match.participantBId);
    const isParticipantA = participantA?.userId === req.user.id;
    const isParticipantB = participantB?.userId === req.user.id;
    if (!isParticipantA && !isParticipantB) {
      return res.status(403).json({ error: 'You are not a participant in this match' });
    }

    if (match.status === 'TIEBREAKER') {
      const tournamentMatches = await prisma.tournamentMatch.findMany({
        where: { tournamentId: tournament.id },
        select: { round: true },
      });
      const latestRound = Math.max(...tournamentMatches.map((item) => item.round));
      const latestRoundMatchCount = tournamentMatches.filter((item) => item.round === latestRound).length;
      const isFinal = match.round === latestRound && latestRoundMatchCount === 1;
      const tieBreaker = await prisma.tournamentTieBreaker.findFirst({
        where: { matchId: match.id, resolvedAt: null },
        orderBy: { round: 'desc' },
      });
      if (!tieBreaker) {
        return res.status(409).json({ error: 'Sudden-death question is not ready yet' });
      }

      const answerSubmitted = isParticipantA
        ? tieBreaker.participantACompletedAt
        : tieBreaker.participantBCompletedAt;
      if (answerSubmitted) {
        return res.status(409).json({ error: 'You already answered this sudden-death question' });
      }

      const question = await prisma.question.findUnique({ where: { id: tieBreaker.questionId } });
      if (!question) {
        return res.status(500).json({ error: 'Sudden-death question is unavailable' });
      }

      return res.json({
        matchId: match.id,
        participantId: isParticipantA ? match.participantAId : match.participantBId,
        mode: 'TIEBREAKER',
        tieBreakerRound: tieBreaker.round,
        questions: [{
          id: question.id,
          level: question.level,
          difficulty: question.difficulty,
          topicSyllabusTag: question.topicSyllabusTag,
          questionText: question.questionText,
          options: JSON.parse(question.options),
          points: question.points,
        }],
        totalQuestions: 1,
        timeLimitSec: 60,
        isFinal,
        startedAt: new Date().toISOString(),
      });
    }

    // 5-minute start window: must start within 5 min of scheduled time.
    // After the window, the match is forfeited by the sweeper.
    const now = new Date();
    const scheduled = new Date(tournament.scheduledAt);
    const diffSec = (now - scheduled) / 1000;
    if (diffSec < 0 || diffSec > START_WINDOW_SEC) {
      const opponentStarted = isParticipantA ? match.participantBStartedAt : match.participantAStartedAt;
      return res.status(403).json({
        error: opponentStarted
          ? 'Start window has passed — you forfeited this match'
          : 'Start window has passed (5 minutes after scheduled time)',
      });
    }

    const participant = isParticipantA ? participantA : participantB;
    const alreadyStarted = isParticipantA
      ? match.participantAStartedAt
      : match.participantBStartedAt;
    if (alreadyStarted) {
      return res.status(409).json({ error: 'You have already started this match' });
    }

    const tournamentMatches = await prisma.tournamentMatch.findMany({
      where: { tournamentId: tournament.id },
      select: { round: true },
    });
    const latestRound = Math.max(...tournamentMatches.map((item) => item.round));
    const latestRoundMatchCount = tournamentMatches.filter((item) => item.round === latestRound).length;
    const isFinal = match.round === latestRound && latestRoundMatchCount === 1;
    const totalQuestions = isFinal ? 30 : 20;
    const timeLimitMin = isFinal ? tournament.finalDurationMin : tournament.durationMin;

    // Progressive difficulty: easy → medium → hard
    const easyCount = Math.floor(totalQuestions * 0.4);
    const mediumCount = Math.floor(totalQuestions * 0.35);
    const hardCount = totalQuestions - easyCount - mediumCount;

    const structure = [
      { difficulty: 'easy', count: easyCount },
      { difficulty: 'medium', count: mediumCount },
      { difficulty: 'hard', count: hardCount },
    ];

    const participantLevelIndex = LEVEL_INDEX[participant.level] || 0;
    const eligibleLevels = LEVELS.filter(
      (_, index) => Math.abs(index - participantLevelIndex) <= 2
    );
    const questions = await selectBalancedQuizQuestions(prisma, {
      userId: req.user.id,
      levels: eligibleLevels,
      mode: 'TOURNAMENT',
      structure,
    });

    if (questions.length < totalQuestions) {
      return res.status(409).json({
        error: `Not enough eligible questions for this match: required ${totalQuestions}, found ${questions.length}`,
      });
    }

    const sanitized = questions.map((q) => ({
      id: q.id,
      level: q.level,
      cefrLevel: q.cefrLevel,
      difficulty: q.difficulty,
      questionType: q.questionType || 'MULTIPLE_CHOICE',
      topicSyllabusTag: q.topicSyllabusTag,
      questionText: q.questionText,
      options: JSON.parse(q.options),
      questionData: parseQuestionData(q),
      points: q.points,
    }));

    // Update match status
    await prisma.tournamentMatch.update({
      where: { id: match.id },
      data: {
        status: 'IN_PROGRESS',
        ...(isParticipantA
          ? { participantAStartedAt: now }
          : { participantBStartedAt: now }),
      },
    });

    res.json({
      matchId: match.id,
      participantId: participant.id,
      mode: 'MATCH',
      questions: sanitized,
      totalQuestions: sanitized.length,
      timeLimitSec: timeLimitMin * 60,
      isFinal,
      startedAt: now.toISOString(),
    });
  } catch (err) {
    console.error('Match start error:', err);
    res.status(500).json({ error: 'Failed to start match' });
  }
});

// ─── POST /api/tournaments/:id/matches/:matchId/submit ──────────────────────
// Student: submit match answers. Resolves the match and advances the bracket.
router.post('/:id/matches/:matchId/submit', requireAuth, async (req, res) => {
  try {
    const { answers, durationSec, tieBreakerRound } = req.body || {};
    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: 'answers[] is required' });
    }

    const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const match = await prisma.tournamentMatch.findUnique({ where: { id: req.params.matchId } });
    if (!match || match.tournamentId !== tournament.id) {
      return res.status(404).json({ error: 'Match not found' });
    }
    if (['COMPLETED', 'BYE'].includes(match.status)) {
      return res.status(409).json({ error: 'Match is already completed' });
    }

    const matchParticipants = await prisma.tournamentParticipant.findMany({
      where: {
        id: { in: [match.participantAId, match.participantBId].filter(Boolean) },
      },
    });
    const participantA = matchParticipants.find((p) => p.id === match.participantAId);
    const participantB = matchParticipants.find((p) => p.id === match.participantBId);
    const isParticipantA = participantA?.userId === req.user.id;
    const isParticipantB = participantB?.userId === req.user.id;
    if (!isParticipantA && !isParticipantB) {
      return res.status(403).json({ error: 'You are not a participant in this match' });
    }

    if (match.status === 'TIEBREAKER') {
      if (answers.length !== 1 || !Number.isInteger(answers[0].selectedAnswer)) {
        return res.status(400).json({ error: 'A sudden-death answer is required' });
      }

      const currentTieBreaker = await prisma.tournamentTieBreaker.findFirst({
        where: { matchId: match.id, resolvedAt: null },
        orderBy: { round: 'desc' },
      });
      if (!currentTieBreaker || currentTieBreaker.round !== tieBreakerRound) {
        return res.status(409).json({ error: 'This sudden-death question has expired' });
      }
      if (answers[0].questionId !== currentTieBreaker.questionId) {
        return res.status(400).json({ error: 'Answer does not match the current sudden-death question' });
      }
      const tieBreakerQuestion = await prisma.question.findUnique({
        where: { id: currentTieBreaker.questionId },
      });
      if (!tieBreakerQuestion) {
        return res.status(500).json({ error: 'Sudden-death question is unavailable' });
      }
      const options = JSON.parse(tieBreakerQuestion.options);
      if (answers[0].selectedAnswer < -1 || answers[0].selectedAnswer >= options.length) {
        return res.status(400).json({ error: 'Selected answer is not a valid option' });
      }
      const ownCorrect = answers[0].selectedAnswer === tieBreakerQuestion.correctAnswer;

      const answerField = isParticipantA ? 'participantAAnswer' : 'participantBAnswer';
      const completedField = isParticipantA ? 'participantACompletedAt' : 'participantBCompletedAt';
      const now = new Date();
      const resolution = await prisma.$transaction(async (tx) => {
        const answerUpdate = await tx.tournamentTieBreaker.updateMany({
          where: { id: currentTieBreaker.id, [answerField]: null },
          data: { [answerField]: answers[0].selectedAnswer, [completedField]: now },
        });
        if (answerUpdate.count !== 1) {
          return { error: 'You already answered this sudden-death question' };
        }

        const answeredRound = await tx.tournamentTieBreaker.findUnique({
          where: { id: currentTieBreaker.id },
        });
        if (!answeredRound.participantACompletedAt || !answeredRound.participantBCompletedAt) {
          return {
            matchStatus: 'TIEBREAKER',
            tieBreakerRound: answeredRound.round,
            waitingForOpponent: true,
            score: ownCorrect ? tieBreakerQuestion.points : 0,
            correctCount: ownCorrect ? 1 : 0,
          };
        }

        const claimed = await tx.tournamentTieBreaker.updateMany({
          where: { id: answeredRound.id, resolvedAt: null },
          data: { resolvedAt: now },
        });
        if (claimed.count !== 1) {
          return {
            matchStatus: 'TIEBREAKER',
            tieBreakerRound: answeredRound.round,
            waitingForOpponent: true,
            score: ownCorrect ? tieBreakerQuestion.points : 0,
            correctCount: ownCorrect ? 1 : 0,
          };
        }

        const aIsCorrect = answeredRound.participantAAnswer === tieBreakerQuestion.correctAnswer;
        const bIsCorrect = answeredRound.participantBAnswer === tieBreakerQuestion.correctAnswer;
        if (aIsCorrect !== bIsCorrect) {
          const winnerId = aIsCorrect ? match.participantAId : match.participantBId;
          const loserId = aIsCorrect ? match.participantBId : match.participantAId;
          await tx.tournamentTieBreaker.update({
            where: { id: answeredRound.id },
            data: { winnerId },
          });
          const claimedMatch = await tx.tournamentMatch.updateMany({
            where: { id: match.id, status: 'TIEBREAKER' },
            data: { status: 'RESOLVING' },
          });
          if (claimedMatch.count === 1) {
            await resolveCompletedMatch(tx, tournament.id, match.id, winnerId, loserId);
          }
          return {
            matchStatus: 'COMPLETED',
            winnerId,
            tieBreakerRound: answeredRound.round,
            score: ownCorrect ? tieBreakerQuestion.points : 0,
            correctCount: ownCorrect ? 1 : 0,
          };
        }

        const nextRound = answeredRound.round + 1;
        await createTieBreaker(tx, match, participantA, participantB, nextRound);
        return {
          matchStatus: 'TIEBREAKER',
          tieBreakerRound: nextRound,
          waitingForOpponent: false,
          score: ownCorrect ? tieBreakerQuestion.points : 0,
          correctCount: ownCorrect ? 1 : 0,
        };
      });

      if (resolution.error) return res.status(409).json({ error: resolution.error });
      return res.json({
        totalQuestions: 1,
        ...resolution,
      });
    }

    const participantId = isParticipantA ? match.participantAId : match.participantBId;
    const participant = isParticipantA ? participantA : participantB;
    const participantStartedAt = isParticipantA
      ? match.participantAStartedAt
      : match.participantBStartedAt;
    const participantCompletedAt = isParticipantA
      ? match.participantACompletedAt
      : match.participantBCompletedAt;
    if (!participantStartedAt) {
      return res.status(400).json({ error: 'Start the match before submitting answers' });
    }
    if (participantCompletedAt) {
      return res.status(409).json({ error: 'You have already submitted this match' });
    }

    // Score the answers
    const questionIds = answers.map((a) => a.questionId);
    const questions = await prisma.question.findMany({ where: { id: { in: questionIds } } });
    const qMap = Object.fromEntries(questions.map((q) => [q.id, q]));

    let score = 0;
    let correctCount = 0;
    const answerDetails = [];

    for (const ans of answers) {
      const q = qMap[ans.questionId];
      if (!q) continue;
      const isCorrect = isQuestionAnswerCorrect(q, ans.selectedAnswer);
      const points = isCorrect ? q.points : 0;
      if (isCorrect) correctCount++;
      score += points;
      answerDetails.push({
        questionId: q.id,
        selectedAnswer: ans.selectedAnswer,
        correct: isCorrect,
        points,
      });
    }

    const now = new Date();
    const completionField = isParticipantA ? 'participantACompletedAt' : 'participantBCompletedAt';
    const scoreField = isParticipantA ? 'participantAScore' : 'participantBScore';
    const submissionSaved = await prisma.$transaction(async (tx) => {
      const matchSubmission = await tx.tournamentMatch.updateMany({
        where: { id: match.id, status: 'IN_PROGRESS', [completionField]: null },
        data: { [scoreField]: score, [completionField]: now },
      });
      if (matchSubmission.count !== 1) return false;

      await tx.tournamentParticipant.update({
        where: { id: participantId },
        data: { score, completedAt: now },
      });
      await tx.quizAttempt.create({
        data: {
          userId: req.user.id,
          quizType: 'TOURNAMENT',
          level: participant.level,
          totalQuestions: answers.length,
          correctCount,
          score,
          durationSec: durationSec || null,
          answers: JSON.stringify(answerDetails),
          startedAt: participantStartedAt,
          completedAt: now,
          matchId: match.id,
        },
      });
      return true;
    });
    if (!submissionSaved) {
      return res.status(409).json({ error: 'You have already submitted this match' });
    }

    const resolution = await prisma.$transaction(async (tx) => {
      const latestMatch = await tx.tournamentMatch.findUnique({ where: { id: match.id } });
      if (!latestMatch.participantACompletedAt || !latestMatch.participantBCompletedAt) {
        return { matchStatus: latestMatch.status, winnerId: null, tieBreakerRound: null };
      }

      const claim = await tx.tournamentMatch.updateMany({
        where: { id: match.id, status: 'IN_PROGRESS' },
        data: { status: 'RESOLVING' },
      });
      if (claim.count !== 1) {
        const currentMatch = await tx.tournamentMatch.findUnique({ where: { id: match.id } });
        return { matchStatus: currentMatch.status, winnerId: currentMatch.winnerId, tieBreakerRound: null };
      }

      if (latestMatch.participantAScore === latestMatch.participantBScore) {
        await createTieBreaker(tx, latestMatch, participantA, participantB, 1);
        await tx.tournamentMatch.update({
          where: { id: match.id },
          data: { status: 'TIEBREAKER' },
        });
        return { matchStatus: 'TIEBREAKER', winnerId: null, tieBreakerRound: 1 };
      }

      const winnerId = latestMatch.participantAScore > latestMatch.participantBScore
        ? latestMatch.participantAId
        : latestMatch.participantBId;
      const loserId = winnerId === latestMatch.participantAId
        ? latestMatch.participantBId
        : latestMatch.participantAId;
      await resolveCompletedMatch(tx, tournament.id, match.id, winnerId, loserId);
      return { matchStatus: 'COMPLETED', winnerId, tieBreakerRound: null };
    });

    res.json({
      score,
      correctCount,
      totalQuestions: answers.length,
      ...resolution,
    });
  } catch (err) {
    console.error('Match submit error:', err);
    res.status(500).json({ error: 'Failed to submit match' });
  }
});

// ─── GET /api/tournaments/:id/mistakes ──────────────────────────────────────
// Per-participant wrong answers for a tournament (from QuizAttempt records).
router.get('/:id/mistakes', requireAuth, async (req, res) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
    });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id },
    });
    const userIds = participants.map((p) => p.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const attempts = await prisma.quizAttempt.findMany({
      where: { userId: { in: userIds }, quizType: 'TOURNAMENT' },
      orderBy: { completedAt: 'asc' },
    });
    const questionIds = [...new Set(
      attempts.flatMap((a) => {
        try { return JSON.parse(a.answers).map((x) => x.questionId); } catch { return []; }
      })
    )];
    const questions = await prisma.question.findMany({ where: { id: { in: questionIds } } });
    const qMap = Object.fromEntries(questions.map((q) => [q.id, q]));

    res.json({
      participants: participants.map((p) => {
        const ownAttempts = attempts.filter((a) => a.userId === p.userId);
        const wrong = [];
        for (const attempt of ownAttempts) {
          let details = [];
          try { details = JSON.parse(attempt.answers); } catch { details = []; }
          for (const d of details) {
            if (d.correct) continue;
            const q = qMap[d.questionId];
            if (!q) continue;
            const options = JSON.parse(q.options);
            wrong.push({
              questionId: q.id,
              questionText: q.questionText,
              selectedAnswer: d.selectedAnswer,
              selectedText: d.selectedAnswer >= 0 ? options[d.selectedAnswer] : 'No answer',
              correctAnswer: q.correctAnswer,
              correctText: options[q.correctAnswer],
            });
          }
        }
        return {
          participantId: p.id,
          name: `${userMap[p.userId]?.firstName || ''} ${userMap[p.userId]?.lastName || ''}`.trim() || 'Unknown',
          avatarUrl: userMap[p.userId]?.avatarUrl || null,
          score: p.score,
          isEliminated: p.isEliminated,
          wrongCount: wrong.length,
          wrong: wrong,
        };
      }),
    });
  } catch (err) {
    console.error('Tournament mistakes error:', err);
    res.status(500).json({ error: 'Failed to fetch mistakes' });
  }
});

// ─── GET /api/tournaments/:id/review/:participantId ─────────────────────────
// Full answer review for one participant: every question with the selected
// and correct answer (used by the bracket name click).
router.get('/:id/review/:participantId', requireAuth, async (req, res) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
    });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const participant = await prisma.tournamentParticipant.findFirst({
      where: { id: req.params.participantId, tournamentId: tournament.id },
    });
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    const user = await prisma.user.findUnique({
      where: { id: participant.userId },
      select: { firstName: true, lastName: true, avatarUrl: true },
    });

    // When a matchId is provided, show only the questions for that specific
    // round (20 questions, or 30 for the final). Older attempts (created
    // before matchId tracking existed) have a null matchId, so if the filter
    // returns nothing we fall back to all of the participant's tournament
    // attempts rather than showing an empty review.
    const matchId = req.query.matchId || null;
    let attempts = [];
    if (matchId) {
      attempts = await prisma.quizAttempt.findMany({
        where: { userId: participant.userId, quizType: 'TOURNAMENT', matchId },
        orderBy: { completedAt: 'asc' },
      });
    }
    if (attempts.length === 0) {
      attempts = await prisma.quizAttempt.findMany({
        where: { userId: participant.userId, quizType: 'TOURNAMENT' },
        orderBy: { completedAt: 'asc' },
      });
    }
    const questionIds = [...new Set(
      attempts.flatMap((a) => {
        try { return JSON.parse(a.answers).map((x) => x.questionId); } catch { return []; }
      })
    )];
    const questions = await prisma.question.findMany({ where: { id: { in: questionIds } } });
    const qMap = Object.fromEntries(questions.map((q) => [q.id, q]));

    const answers = [];
    for (const attempt of attempts) {
      let details = [];
      try { details = JSON.parse(attempt.answers); } catch { details = []; }
      for (const d of details) {
        const q = qMap[d.questionId];
        if (!q) continue;
        const options = JSON.parse(q.options);
        answers.push({
          questionText: q.questionText,
          topicSyllabusTag: q.topicSyllabusTag,
          selectedAnswer: d.selectedAnswer,
          selectedText: d.selectedAnswer >= 0 ? options[d.selectedAnswer] : 'No answer',
          correctAnswer: q.correctAnswer,
          correctText: options[q.correctAnswer],
          correct: Boolean(d.correct),
          points: d.points || 0,
        });
      }
    }

    // When a specific match is being reviewed, show that match's score
    // (sum of the filtered attempts) instead of the participant's last score.
    const reviewScore = matchId && attempts.length > 0
      ? attempts.reduce((sum, a) => sum + (a.score || 0), 0)
      : participant.score;

    res.json({
      name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Unknown',
      avatarUrl: user?.avatarUrl || null,
      level: participant.level,
      score: reviewScore,
      isEliminated: participant.isEliminated,
      answers,
    });
  } catch (err) {
    console.error('Tournament review error:', err);
    res.status(500).json({ error: 'Failed to fetch review' });
  }
});

// Start the forfeit sweeper once when the routes module loads.
startForfeitSweeper();

// ─── DELETE /api/tournaments/:id ────────────────────────────────────────────
// Teacher/Admin: delete a scheduled tournament.
router.delete('/:id', requireAuth, requireRole('TEACHER'), async (req, res) => {
  try {
    const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id } });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status === 'ACTIVE') {
      return res.status(400).json({ error: 'Cannot delete an active tournament' });
    }

    await prisma.tournamentMatch.deleteMany({ where: { tournamentId: tournament.id } });
    await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } });
    await prisma.tournament.delete({ where: { id: tournament.id } });

    res.json({ ok: true });
  } catch (err) {
    console.error('Tournament delete error:', err);
    res.status(500).json({ error: 'Failed to delete tournament' });
  }
});

module.exports = router;
