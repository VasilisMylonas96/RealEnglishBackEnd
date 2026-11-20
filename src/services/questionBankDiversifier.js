const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const TYPES = [
  ['MULTIPLE_CHOICE', 35],
  ['SENTENCE_ORDERING', 20],
  ['FILL_IN_THE_BLANK', 20],
  ['ERROR_CORRECTION', 10],
  ['SYNONYM_ANTONYM', 10],
  ['TRUE_FALSE', 5],
];
const CEFR_BY_CLASS = {
  'A-Junior': 'A1',
  'B-Junior': 'A2',
  'A-Senior': 'B1',
  'B-Senior': 'B2',
  'C-Junior': 'C1',
  'C-Senior': 'C2',
};
const ACTION_TERMS = [
  { base: 'check', object: 'the daily schedule', synonym: 'inspect' },
  { base: 'prepare', object: 'the lesson materials', synonym: 'arrange' },
  { base: 'visit', object: 'the local museum', synonym: 'explore' },
  { base: 'organize', object: 'the class library', synonym: 'arrange' },
  { base: 'study', object: 'the new vocabulary', synonym: 'learn' },
  { base: 'write', object: 'a detailed report', synonym: 'compose' },
  { base: 'choose', object: 'the best available option', synonym: 'select' },
  { base: 'build', object: 'a model of the bridge', synonym: 'construct' },
  { base: 'teach', object: 'the next grammar point', synonym: 'instruct' },
  { base: 'make', object: 'a clear study plan', synonym: 'create' },
  { base: 'send', object: 'the final invitation', synonym: 'dispatch' },
  { base: 'bring', object: 'the required documents', synonym: 'carry' },
  { base: 'explain', object: 'the main idea', synonym: 'clarify' },
  { base: 'review', object: 'the latest draft', synonym: 'assess' },
  { base: 'design', object: 'a useful learning activity', synonym: 'plan' },
  { base: 'repair', object: 'the classroom computer', synonym: 'fix' },
  { base: 'discuss', object: 'the proposed changes', synonym: 'debate' },
  { base: 'publish', object: 'the research summary', synonym: 'release' },
  { base: 'analyze', object: 'the survey results', synonym: 'examine' },
  { base: 'develop', object: 'a practical solution', synonym: 'improve' },
  { base: 'find', object: 'the missing reference', synonym: 'discover' },
  { base: 'give', object: 'a short presentation', synonym: 'provide' },
  { base: 'speak', object: 'the opening paragraph aloud', synonym: 'talk' },
  { base: 'drive', object: 'the school minibus', synonym: 'operate' },
  { base: 'take', object: 'accurate notes', synonym: 'record' },
  { base: 'see', object: 'the difference between the examples', synonym: 'notice' },
  { base: 'paint', object: 'a sign for the event', synonym: 'decorate' },
  { base: 'clean', object: 'the science laboratory', synonym: 'wash' },
  { base: 'compare', object: 'the two proposals', synonym: 'contrast' },
  { base: 'collect', object: 'feedback from the class', synonym: 'gather' },
];
const UPDATE_FIELDS = [
  'questionType',
  'questionText',
  'options',
  'correctAnswer',
  'correctAnswerText',
  'questionData',
  'updatedAt',
];

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function allocateTypeCounts(total) {
  const exact = TYPES.map(([, percentage]) => (total * percentage) / 100);
  const counts = exact.map(Math.floor);
  let remainder = total - counts.reduce((sum, count) => sum + count, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - counts[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index++) counts[order[index].index]++;
  return Object.fromEntries(TYPES.map(([type], index) => [type, counts[index]]));
}

function tokenize(sentence) {
  return sentence.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*|[.,!?;:]/g) || [];
}

function stableShuffle(items, seed) {
  return items
    .map((value, index) => ({ value, rank: hash(`${seed}|${index}|${value}`) }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map((item) => item.value);
}

function actionForQuestion(question) {
  const questionText = question.questionText.toLowerCase();
  return ACTION_TERMS.find((action) => questionText.includes(action.object));
}

function convertQuestion(question, type) {
  const options = JSON.parse(question.options);
  const answer = options[question.correctAnswer];
  if (!answer || !question.questionText.includes('___')) {
    throw new Error(`Generated question ${question.id} cannot be converted safely`);
  }
  const parts = question.questionText.split('___');
  const completeSentence = `${parts[0]}${answer}${parts.slice(1).join('___')}`;
  let converted;

  if (type === 'FILL_IN_THE_BLANK') {
    converted = {
      questionType: type,
      questionText: `Complete the sentence: ${question.questionText}`,
      options,
      correctAnswer: question.correctAnswer,
      correctAnswerText: answer,
      questionData: { sentenceParts: [question.questionText] },
    };
  } else if (type === 'SENTENCE_ORDERING') {
    const correctOrder = tokenize(completeSentence);
    if (correctOrder.length < 2) throw new Error(`Question ${question.id} has no orderable sentence`);
    converted = {
      questionType: type,
      questionText: `Put the words in the correct order: ${question.questionText}`,
      options: stableShuffle(correctOrder, `${question.id}|ordering`),
      correctAnswer: 0,
      correctAnswerText: JSON.stringify(correctOrder),
      questionData: null,
    };
  } else if (type === 'ERROR_CORRECTION') {
    const wrongAnswer = options.find((option, index) => index !== question.correctAnswer);
    const beforeBlank = tokenize(parts[0]);
    const afterBlank = tokenize(parts.slice(1).join('___'));
    const incorrectSentence = `${parts[0]}${wrongAnswer}${parts.slice(1).join('___')}`;
    converted = {
      questionType: type,
      questionText: `Find and correct the error: ${incorrectSentence}`,
      options: [...beforeBlank, wrongAnswer, ...afterBlank],
      correctAnswer: beforeBlank.length,
      correctAnswerText: wrongAnswer,
      questionData: { correction: answer },
    };
  } else if (type === 'SYNONYM_ANTONYM') {
    const action = actionForQuestion(question);
    if (!action) throw new Error(`No vocabulary mapping found for question ${question.id}`);
    const alternatives = ACTION_TERMS
      .filter((term) => term.base !== action.base && term.base !== action.synonym)
      .map((term) => term.base)
      .slice(0, 3);
    const synonymOptions = stableShuffle([action.synonym, ...alternatives], `${question.id}|synonym`);
    converted = {
      questionType: type,
      questionText: `In "${completeSentence}", which word is closest in meaning to "${action.base}"?`,
      options: synonymOptions,
      correctAnswer: synonymOptions.indexOf(action.synonym),
      correctAnswerText: action.synonym,
      questionData: { targetWord: action.base, mode: 'SYNONYM' },
    };
  } else if (type === 'TRUE_FALSE') {
    const falseStatement = Number.parseInt(hash(`${question.id}|true-false`).slice(0, 2), 16) % 2 === 0;
    const statementAnswer = falseStatement
      ? options.find((option, index) => index !== question.correctAnswer)
      : answer;
    const statement = `${parts[0]}${statementAnswer}${parts.slice(1).join('___')}`;
    converted = {
      questionType: type,
      questionText: `Is this sentence grammatically correct? ${statement}`,
      options: ['True', 'False'],
      correctAnswer: falseStatement ? 1 : 0,
      correctAnswerText: falseStatement ? 'False' : 'True',
      questionData: null,
    };
  } else {
    throw new Error(`Unsupported question type: ${type}`);
  }

  return {
    id: question.id,
    ...converted,
    options: JSON.stringify(converted.options),
    questionData: converted.questionData ? JSON.stringify(converted.questionData) : null,
    updatedAt: new Date(),
  };
}

async function applyUpdates(prisma, updates) {
  const batchSize = 50;
  for (let start = 0; start < updates.length; start += batchSize) {
    const batch = updates.slice(start, start + batchSize);
    const assignments = UPDATE_FIELDS.map((field) => Prisma.sql`
      "${Prisma.raw(field)}" = CASE "id"
        ${Prisma.join(batch.map((item) => Prisma.sql`WHEN ${item.id} THEN ${item[field]}`), ' ')}
        ELSE "${Prisma.raw(field)}"
      END
    `);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "Question"
      SET ${Prisma.join(assignments, ', ')}
      WHERE "id" IN (${Prisma.join(batch.map((item) => item.id))})
    `);
    console.log(`Diversified ${Math.min(start + batchSize, updates.length)} / ${updates.length}`);
  }
}

async function diversifyQuestionBank(prisma) {
  const questions = await prisma.question.findMany({
    where: { id: { startsWith: 'generated-' } },
    select: {
      id: true,
      level: true,
      difficulty: true,
      questionText: true,
      options: true,
      correctAnswer: true,
      questionType: true,
    },
  });
  const buckets = new Map();
  for (const question of questions) {
    const key = `${question.level}|${question.difficulty}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(question);
  }

  const updates = [];
  for (const [bucket, items] of buckets) {
    const currentCounts = Object.fromEntries(TYPES.map(([type]) => [type, 0]));
    items.forEach((question) => {
      const type = TYPES.some(([candidate]) => candidate === question.questionType)
        ? question.questionType
        : 'MULTIPLE_CHOICE';
      currentCounts[type]++;
    });
    const targets = allocateTypeCounts(items.length);
    const available = items
      .filter((question) => (question.questionType || 'MULTIPLE_CHOICE') === 'MULTIPLE_CHOICE')
      .sort((a, b) => a.id.localeCompare(b.id));
    const level = items[0]?.level;
    const cefrLevel = CEFR_BY_CLASS[level];

    if (!cefrLevel) throw new Error(`Unknown student level in question bank: ${level}`);
    await prisma.question.updateMany({
      where: { id: { startsWith: 'generated-' }, level, cefrLevel: null },
      data: { cefrLevel, updatedAt: new Date() },
    });
    await prisma.question.updateMany({
      where: { id: { startsWith: 'generated-' }, level, sourceFlag: null },
      data: { sourceFlag: 'SYSTEM_GENERATED', updatedAt: new Date() },
    });

    let convertedCount = 0;
    for (const [type] of TYPES) {
      if (type === 'MULTIPLE_CHOICE') continue;
      const needed = Math.max(0, targets[type] - currentCounts[type]);
      for (let index = 0; index < needed; index++) {
        const candidateIndex = type === 'SYNONYM_ANTONYM'
          ? available.findIndex(actionForQuestion)
          : (available.length ? 0 : -1);
        if (candidateIndex < 0) {
          throw new Error(`${bucket}: not enough source questions to create ${type}`);
        }
        const [candidate] = available.splice(candidateIndex, 1);
        updates.push(convertQuestion(candidate, type));
        convertedCount++;
      }
    }
    console.log(`${bucket}: ${convertedCount} questions diversified`);
  }
  await applyUpdates(prisma, updates);
  return { generatedQuestionCount: questions.length, convertedQuestionCount: updates.length };
}

module.exports = { diversifyQuestionBank, allocateTypeCounts, convertQuestion };
