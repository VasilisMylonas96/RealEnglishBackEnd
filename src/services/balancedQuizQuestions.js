const TYPES = [
  'MULTIPLE_CHOICE',
  'SENTENCE_ORDERING',
  'FILL_IN_THE_BLANK',
  'ERROR_CORRECTION',
  'SYNONYM_ANTONYM',
  'TRUE_FALSE',
];

const DEFAULT_DISTRIBUTION = {
  MULTIPLE_CHOICE: 35,
  SENTENCE_ORDERING: 20,
  FILL_IN_THE_BLANK: 20,
  ERROR_CORRECTION: 10,
  SYNONYM_ANTONYM: 10,
  TRUE_FALSE: 5,
};

function getTypeQuotas(total, distribution) {
  const weights = TYPES.map((type) => {
    const weight = Number(distribution[type]);
    return Number.isFinite(weight) && weight > 0 ? weight : 0;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (!weightTotal) return getTypeQuotas(total, DEFAULT_DISTRIBUTION);

  const exact = weights.map((weight) => (weight / weightTotal) * total);
  const quotas = exact.map(Math.floor);
  let remainder = total - quotas.reduce((sum, quota) => sum + quota, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - quotas[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index++) quotas[order[index].index]++;
  return Object.fromEntries(TYPES.map((type, index) => [type, quotas[index]]));
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

async function randomQuestionSample(prisma, where, minimum) {
  const total = await prisma.question.count({ where });
  if (!total) return [];
  const take = Math.min(total, Math.max(100, minimum * 10));
  const maxSkip = Math.max(0, total - take);
  const skip = maxSkip ? Math.floor(Math.random() * (maxSkip + 1)) : 0;
  const rows = await prisma.question.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    skip,
    take,
  });
  return shuffle(rows);
}

function readRecentCorrectIds(attempts) {
  const ids = new Set();
  for (const attempt of attempts) {
    try {
      JSON.parse(attempt.answers).forEach((answer) => {
        if (answer.correct && typeof answer.questionId === 'string') ids.add(answer.questionId);
      });
    } catch (err) {
      console.warn(`Skipping malformed quiz attempt answers for attempt ${attempt.id}`);
    }
  }
  return [...ids];
}

async function selectBalancedQuizQuestions(prisma, { userId, level, levels, mode, structure }) {
  const config = await prisma.quizModeConfig.findUnique({ where: { mode } });
  const distribution = config?.typeDistributionJson
    ? JSON.parse(config.typeDistributionJson)
    : DEFAULT_DISTRIBUTION;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const recentAttempts = await prisma.quizAttempt.findMany({
    where: { userId, completedAt: { gte: cutoff } },
    select: { id: true, answers: true },
  });
  const excludedIds = readRecentCorrectIds(recentAttempts);
  const eligibleLevels = levels || [level];
  const difficultySlots = structure.flatMap(({ difficulty, count }) => Array(count).fill(difficulty));
  const quotas = getTypeQuotas(difficultySlots.length, distribution);
  const buckets = {};

  for (const { difficulty, count } of structure) {
    const baseWhere = {
      level: { in: eligibleLevels },
      difficulty,
      questionType: { in: TYPES },
      status: 'ACTIVE',
      ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
    };
    let rows = [];
    if (config?.onlyScannedQuestions) {
      let flags = [];
      try {
        flags = JSON.parse(config.allowedSourceFlags || '[]');
      } catch (err) {
        throw new Error(`Invalid allowed source flags in ${mode} quiz settings`);
      }
      const scannedWhere = {
        ...baseWhere,
        isScannedSource: true,
        ...(flags.length ? { sourceFlag: { in: flags } } : {}),
      };
      rows = await randomQuestionSample(prisma, scannedWhere, count);
      if (rows.length < count) {
        const alreadySelected = rows.map((question) => question.id);
        const fallbackWhere = {
          ...baseWhere,
          isScannedSource: false,
          ...(alreadySelected.length ? { id: { notIn: [...excludedIds, ...alreadySelected] } } : {}),
        };
        rows.push(...await randomQuestionSample(prisma, fallbackWhere, count - rows.length));
      }
    } else {
      rows = await randomQuestionSample(prisma, baseWhere, count);
    }
    buckets[difficulty] = rows;
  }

  const selected = [];
  let previousType = null;
  const remainingSlots = [...difficultySlots];
  const orderTypes = () => TYPES
    .filter((type) => quotas[type] > 0)
    .sort((a, b) => quotas[b] - quotas[a] || TYPES.indexOf(a) - TYPES.indexOf(b));

  while (remainingSlots.length) {
    const difficulty = remainingSlots.shift();
    const candidates = buckets[difficulty] || [];
    const availableTypes = orderTypes();
    let question = null;

    for (const type of availableTypes) {
      if (type === previousType && availableTypes.some((other) => other !== type && candidates.some((item) => item.questionType === other))) {
        continue;
      }
      question = candidates.find((item) => item.questionType === type) || null;
      if (question) break;
    }
    if (!question && candidates.length) {
      question = candidates.find((item) => item.questionType !== previousType) || candidates[0];
    }
    if (question) {
      buckets[difficulty] = candidates.filter((item) => item.id !== question.id);
      if (quotas[question.questionType] > 0) quotas[question.questionType]--;
      selected.push(question);
      previousType = question.questionType;
    }
  }
  return selected;
}

module.exports = { selectBalancedQuizQuestions, getTypeQuotas };
