/**
 * Seed a dummy COMPLETED tournament with a correct bracket, 1/2/3 point
 * scoring, per-match QuizAttempt records (with matchId), and the existing
 * "mulonas" user as the champion (so the champion banner avatar can be
 * verified). Run: node prisma/seed-dummy-tournament.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const LEVELS = ['A-Junior', 'B-Junior', 'A-Senior', 'B-Senior'];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function main() {
  const tournamentName = `Demo Cup ${new Date().toLocaleDateString('en-GB')}`;
  const scheduledAt = new Date(Date.now() - 2 * 24 * 3600 * 1000);

  // 1. Find the existing mulonas user (the champion — has a real avatar).
  const mulona = await prisma.user.findUnique({ where: { username: 'mulonas' } });
  if (!mulona) throw new Error('mulonas user not found');

  // 2. Create 7 dummy opponents.
  const suffix = Date.now().toString(36);
  const FIRST = ['Anna', 'Nikos', 'Eleni', 'Giorgos', 'Maria', 'Kostas', 'Sofia'];
  const LAST = ['Papadopoulos', 'Georgiou', 'Nikolaou', 'Alexiou', 'Ioannou', 'Papaioannou', 'Kalli'];
  const dummies = [];
  for (let i = 0; i < 7; i++) {
    dummies.push(await prisma.user.upsert({
      where: { username: `demo${i}_${suffix}` },
      update: {},
      create: {
        username: `demo${i}_${suffix}`,
        firstName: FIRST[i],
        lastName: LAST[i],
        password: 'x',
        role: 'STUDENT',
        level: LEVELS[i % LEVELS.length],
      },
    }));
  }

  // 3. Tournament.
  const tournament = await prisma.tournament.create({
    data: {
      name: tournamentName,
      scheduledAt,
      durationMin: 15,
      finalDurationMin: 20,
      status: 'COMPLETED',
      createdBy: mulona.id,
    },
  });

  // 4. Participants: mulona + 7 dummies = 8.
  const allUsers = [mulona, ...dummies];
  const participants = [];
  for (const u of allUsers) {
    participants.push(await prisma.tournamentParticipant.create({
      data: {
        tournamentId: tournament.id,
        userId: u.id,
        level: u.level,
        isEliminated: false,
      },
    }));
  }

  // 5. Get questions (points are now 1/2/3).
  const allQuestions = await prisma.question.findMany();

  // Generate a score sheet for a participant.
  function generateSheet(totalQ, accuracy) {
    const sheet = [];
    let correctCount = 0;
    let score = 0;
    for (let i = 0; i < totalQ; i++) {
      const q = allQuestions[randInt(0, allQuestions.length - 1)];
      const options = JSON.parse(q.options);
      const isWrong = Math.random() > accuracy;
      let selected = q.correctAnswer;
      if (isWrong) {
        const wrongOpts = options.map((_, idx) => idx).filter((idx) => idx !== q.correctAnswer);
        selected = rand(wrongOpts);
      } else {
        correctCount++;
        score += q.points;
      }
      sheet.push({
        questionId: q.id,
        selectedAnswer: selected,
        correct: !isWrong,
        points: isWrong ? 0 : q.points,
      });
    }
    return { sheet, correctCount, score };
  }

  // Create and resolve a single match. Returns { winnerId }.
  async function createAndResolveMatch(round, position, participantA, participantB) {
    const match = await prisma.tournamentMatch.create({
      data: {
        tournamentId: tournament.id,
        round,
        position,
        participantAId: participantA?.id || null,
        participantBId: participantB?.id || null,
      },
    });

    if (!participantA || !participantB) {
      const winner = participantA || participantB;
      await prisma.tournamentMatch.update({
        where: { id: match.id },
        data: { status: 'BYE', winnerId: winner.id },
      });
      return { winnerId: winner.id };
    }

    const isFinal = round === 3;
    const totalQ = isFinal ? 30 : 20;

    // Mulona gets high accuracy (0.92); opponents get 0.35–0.55.
    const aIsMulona = participantA.userId === mulona.id;
    const bIsMulona = participantB.userId === mulona.id;
    const aAcc = aIsMulona ? 0.92 : 0.35 + Math.random() * 0.2;
    const bAcc = bIsMulona ? 0.92 : 0.35 + Math.random() * 0.2;

    const aResult = generateSheet(totalQ, aAcc);
    const bResult = generateSheet(totalQ, bAcc);

    // Winner by score; force mulona to win if she is in the match.
    let winnerId, loserId;
    if (aResult.score >= bResult.score) {
      winnerId = participantA.id;
      loserId = participantB.id;
    } else {
      winnerId = participantB.id;
      loserId = participantA.id;
    }
    if (aIsMulona && winnerId !== participantA.id) {
      winnerId = participantA.id;
      loserId = participantB.id;
    }
    if (bIsMulona && winnerId !== participantB.id) {
      winnerId = participantB.id;
      loserId = participantA.id;
    }

    // Store QuizAttempts with matchId (so the review filters per round).
    await prisma.quizAttempt.create({
      data: {
        userId: participantA.userId,
        quizType: 'TOURNAMENT',
        level: participantA.level,
        totalQuestions: totalQ,
        correctCount: aResult.correctCount,
        score: aResult.score,
        durationSec: randInt(400, 800),
        answers: JSON.stringify(aResult.sheet),
        startedAt: scheduledAt,
        completedAt: new Date(scheduledAt.getTime() + 10 * 60000),
        matchId: match.id,
      },
    });
    await prisma.quizAttempt.create({
      data: {
        userId: participantB.userId,
        quizType: 'TOURNAMENT',
        level: participantB.level,
        totalQuestions: totalQ,
        correctCount: bResult.correctCount,
        score: bResult.score,
        durationSec: randInt(400, 800),
        answers: JSON.stringify(bResult.sheet),
        startedAt: scheduledAt,
        completedAt: new Date(scheduledAt.getTime() + 12 * 60000),
        matchId: match.id,
      },
    });

    await prisma.tournamentMatch.update({
      where: { id: match.id },
      data: {
        status: 'COMPLETED',
        winnerId,
        participantAScore: aResult.score,
        participantBScore: bResult.score,
        participantAStartedAt: scheduledAt,
        participantBStartedAt: scheduledAt,
        participantACompletedAt: new Date(scheduledAt.getTime() + 10 * 60000),
        participantBCompletedAt: new Date(scheduledAt.getTime() + 12 * 60000),
      },
    });

    // Eliminate the loser.
    await prisma.tournamentParticipant.update({
      where: { id: loserId },
      data: { isEliminated: true },
    });

    return { winnerId };
  }

  // 6. Build the bracket round by round (winners advance correctly).
  // R1: 4 matches — mulona is in position 0.
  const r1Pairs = [
    [participants[0], participants[1]],
    [participants[2], participants[3]],
    [participants[4], participants[5]],
    [participants[6], participants[7]],
  ];
  const r1Winners = [];
  for (let i = 0; i < r1Pairs.length; i++) {
    const result = await createAndResolveMatch(1, i, r1Pairs[i][0], r1Pairs[i][1]);
    r1Winners.push(result.winnerId);
  }

  // R2: 2 matches — winners of R1 paired by position.
  const pById = Object.fromEntries(participants.map((p) => [p.id, p]));
  const r2Pairs = [
    [pById[r1Winners[0]], pById[r1Winners[1]]],
    [pById[r1Winners[2]], pById[r1Winners[3]]],
  ];
  const r2Winners = [];
  for (let i = 0; i < r2Pairs.length; i++) {
    const result = await createAndResolveMatch(2, i, r2Pairs[i][0], r2Pairs[i][1]);
    r2Winners.push(result.winnerId);
  }

  // Final: 1 match.
  const finalResult = await createAndResolveMatch(3, 0, pById[r2Winners[0]], pById[r2Winners[1]]);

  // 7. Set each participant's final score (their last match's score).
  const allMatches = await prisma.tournamentMatch.findMany({
    where: { tournamentId: tournament.id },
  });
  for (const p of participants) {
    const pMatches = allMatches.filter(
      (m) => m.participantAId === p.id || m.participantBId === p.id
    );
    const lastMatch = pMatches[pMatches.length - 1];
    const score = lastMatch
      ? (lastMatch.participantAId === p.id ? lastMatch.participantAScore : lastMatch.participantBScore)
      : 0;
    await prisma.tournamentParticipant.update({
      where: { id: p.id },
      data: { score, completedAt: new Date(scheduledAt.getTime() + 12 * 60000) },
    });
  }

  // winnerId is a participant id; map it back to the user.
  const championParticipant = participants.find((p) => p.id === finalResult.winnerId);
  const championUser = allUsers.find((u) => u.id === championParticipant?.userId);
  console.log(`✅ Seeded "${tournamentName}" (id: ${tournament.id})`);
  console.log(`   Champion: ${championUser?.firstName} ${championUser?.lastName} (${championUser?.username})`);
  console.log(`   Users: ${allUsers.map((u) => u.username).join(', ')}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
