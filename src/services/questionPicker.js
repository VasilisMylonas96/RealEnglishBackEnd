const { Prisma } = require('@prisma/client');

async function pickRandomQuestions(prisma, { levels, difficulty, count, excludeIds = [] }) {
  if (!levels.length || count <= 0) return [];

  const excludedQuestions = excludeIds.length
    ? Prisma.sql`AND "id" NOT IN (${Prisma.join(excludeIds)})`
    : Prisma.empty;

  return prisma.$queryRaw(Prisma.sql`
    SELECT *
    FROM "Question"
    WHERE "level" IN (${Prisma.join(levels)})
      AND "difficulty" = ${difficulty}
      AND "questionType" = 'MULTIPLE_CHOICE'
      AND "status" = 'ACTIVE'
      ${excludedQuestions}
    ORDER BY RANDOM()
    LIMIT ${count}
  `);
}

module.exports = { pickRandomQuestions };
