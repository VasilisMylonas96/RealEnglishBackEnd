require('dotenv').config();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { diversifyQuestionBank } = require('../src/services/questionBankDiversifier');

const prisma = new PrismaClient();
const TARGET_TOTAL = 100000;
const LEVELS = ['A-Junior', 'B-Junior', 'A-Senior', 'B-Senior', 'C-Junior', 'C-Senior'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

const SUBJECTS = [
  ['my brother', 'singular'], ['my sister', 'singular'], ['the teacher', 'singular'],
  ['the students', 'plural'], ['our neighbors', 'plural'], ['the new student', 'singular'],
  ['the school team', 'singular'], ['the researchers', 'plural'], ['a careful editor', 'singular'],
  ['the young musicians', 'plural'], ['my grandparents', 'plural'], ['the local librarian', 'singular'],
  ['the volunteers', 'plural'], ['a group of friends', 'singular'], ['the class', 'singular'],
  ['the children', 'plural'], ['our science teacher', 'singular'], ['the office staff', 'plural'],
  ['a skilled mechanic', 'singular'], ['the writers', 'plural'], ['the project manager', 'singular'],
  ['the nurses', 'plural'], ['a team of designers', 'singular'], ['the committee members', 'plural'],
  ['the university lecturer', 'singular'], ['the journalists', 'plural'], ['my cousin', 'singular'],
  ['the language learners', 'plural'], ['the museum guide', 'singular'], ['the engineers', 'plural'],
  ['a thoughtful reviewer', 'singular'], ['the local council', 'singular'], ['the architects', 'plural'],
  ['the debate team', 'singular'], ['the applicants', 'plural'], ['a research fellow', 'singular'],
].map(([phrase, agreement]) => ({ phrase, agreement }));

const ACTIONS = [
  ['check', 'checked', 'checked', 'checking', 'the daily schedule'],
  ['prepare', 'prepared', 'prepared', 'preparing', 'the lesson materials'],
  ['visit', 'visited', 'visited', 'visiting', 'the local museum'],
  ['organize', 'organized', 'organized', 'organizing', 'the class library'],
  ['study', 'studied', 'studied', 'studying', 'the new vocabulary'],
  ['write', 'wrote', 'written', 'writing', 'a detailed report'],
  ['choose', 'chose', 'chosen', 'choosing', 'the best available option'],
  ['build', 'built', 'built', 'building', 'a model of the bridge'],
  ['teach', 'taught', 'taught', 'teaching', 'the next grammar point'],
  ['make', 'made', 'made', 'making', 'a clear study plan'],
  ['send', 'sent', 'sent', 'sending', 'the final invitation'],
  ['bring', 'brought', 'brought', 'bringing', 'the required documents'],
  ['explain', 'explained', 'explained', 'explaining', 'the main idea'],
  ['review', 'reviewed', 'reviewed', 'reviewing', 'the latest draft'],
  ['design', 'designed', 'designed', 'designing', 'a useful learning activity'],
  ['repair', 'repaired', 'repaired', 'repairing', 'the classroom computer'],
  ['discuss', 'discussed', 'discussed', 'discussing', 'the proposed changes'],
  ['publish', 'published', 'published', 'publishing', 'the research summary'],
  ['analyze', 'analyzed', 'analyzed', 'analyzing', 'the survey results'],
  ['develop', 'developed', 'developed', 'developing', 'a practical solution'],
  ['find', 'found', 'found', 'finding', 'the missing reference'],
  ['give', 'gave', 'given', 'giving', 'a short presentation'],
  ['speak', 'spoke', 'spoken', 'speaking', 'the opening paragraph aloud'],
  ['drive', 'drove', 'driven', 'driving', 'the school minibus'],
  ['take', 'took', 'taken', 'taking', 'accurate notes'],
  ['see', 'saw', 'seen', 'seeing', 'the difference between the examples'],
  ['paint', 'painted', 'painted', 'painting', 'a sign for the event'],
  ['clean', 'cleaned', 'cleaned', 'cleaning', 'the science laboratory'],
  ['compare', 'compared', 'compared', 'comparing', 'the two proposals'],
  ['collect', 'collected', 'collected', 'collecting', 'feedback from the class'],
].map(([base, past, participle, gerund, object]) => ({
  base,
  third: base.endsWith('y') ? `${base.slice(0, -1)}ies` : `${base}${['ch', 'sh', 'ss', 'x', 'o'].some((ending) => base.endsWith(ending)) ? 'es' : 's'}`,
  past,
  participle,
  gerund,
  object,
}));

const CUES = {
  present: ['Every morning', 'On school days', 'Usually', 'Each week', 'At the start of term', 'Most afternoons', 'On busy days', 'As a regular habit', 'Before each lesson', 'During the school year', 'Every Friday', 'In the early morning', 'After lunch', 'At the end of each month', 'Whenever there is enough time'],
  continuous: ['Right now', 'At this moment', 'Today', 'This week', 'Look at the classroom camera', 'At present', 'While the others are working', 'For the time being', 'Just now', 'During this lesson', 'As we speak', 'This afternoon', 'At the moment', 'For now', 'While the meeting is in progress'],
  past: ['Yesterday', 'Last week', 'A year ago', 'On Monday', 'During the previous term', 'Earlier that morning', 'A few days ago', 'At the end of last month', 'In the previous lesson', 'Before the holidays', 'Last winter', 'During the last meeting', 'In 2022', 'The day before yesterday', 'At the start of the project'],
  pastContinuous: ['At seven yesterday evening', 'At that exact moment', 'While the lesson was in progress', 'During the afternoon yesterday', 'When the visitor arrived', 'At this time last week', 'While the others were waiting', 'During the previous meeting', 'As the bell rang', 'When the lights went out', 'At noon yesterday', 'While the class was taking a break', 'When the phone rang', 'During the journey', 'As the rain began'],
  perfect: ['So far this term', 'In the last few weeks', 'Since September', 'Over the past year', 'Up to now', 'Recently', 'During their time at the school', 'For several months', 'Since the project began', 'In the last decade', 'Already this morning', 'Over the years', 'For a long time', 'Since the new course started', 'To date'],
  simplePastContrast: ['Yesterday', 'Last month', 'In 2021', 'A week ago', 'On Tuesday', 'During the previous term', 'Before the new course began'],
  perfectContrast: ['So far this year', 'Since the course began', 'In 2021', 'Last summer', 'Up to now', 'Two days ago', 'Over the past month', 'When the school first opened'],
  modal: ['The instructions make it compulsory', 'The rule leaves no alternative', 'The evidence makes it almost certain', 'The schedule makes it advisable', 'There is a real possibility', 'The safety notice makes it necessary', 'The evidence strongly suggests', 'The deadline makes it important'],
  passive: ['Every year', 'At the end of each term', 'In the usual process', 'During each inspection', 'On the first day of the course', 'As part of the review', 'Every few months', 'Under the current policy', 'At each stage', 'In most departments', 'During the annual event', 'Before publication', 'Each semester', 'In the final review', 'As a standard procedure'],
  conditionalResults: ['the team could reach a clearer conclusion', 'the class would have more time to practise', 'the result might be more reliable', 'the project could finish on schedule', 'the discussion would be more productive', 'the school might attract more applicants', 'the report could include stronger evidence', 'the team would understand the issue better', 'the next lesson could be more effective', 'the final proposal might be easier to evaluate', 'the students would have more opportunities', 'the committee could make a better decision', 'the research might answer the main question', 'the participants could share their ideas', 'the course would meet more learning needs'],
  thirdConditional: ['before the deadline', 'with greater care', 'on the first attempt', 'before the meeting began', 'during the previous term', 'with more reliable data', 'before the final review', 'in the original draft', 'at the start of the project', 'before the schedule changed', 'during the earlier discussion', 'with better instructions', 'before the results were published', 'in time for the presentation', 'before the course ended'],
  moreTime: ['during the review', 'before the next meeting', 'for the assignment', 'while the course was running', 'before publication', 'for the preparation', 'during the project', 'before the final decision', 'while the team was planning', 'for the research', 'before the deadline', 'during the training', 'for the presentation', 'while the class was working', 'before the next lesson'],
  subjunctive: ['The supervisor recommends that', 'The committee insists that', 'The principal requests that', 'The report proposes that', 'The tutor suggests that', 'The policy requires that', 'The panel demands that', 'The director advises that', 'The review concludes that', 'The board stipulates that', 'The instructor recommends that', 'The agreement requires that', 'The proposal suggests that', 'The examiner insists that', 'The guidance states that'],
  inversion: ['Rarely', 'Seldom', 'Never before', 'Only once', 'At no point', 'Hardly ever'],
  advancedInversion: ['Not until the final review', 'Only after the meeting', 'Not before the presentation', 'Only when the results were published', 'Not until the next term', 'Only after careful consideration', 'Not until the schedule changed', 'Only when all the evidence was available', 'Not before the course ended', 'Only after the data had been checked'],
};

const CONFIG = {
  'A-Junior': {
    easy: ['Present Simple', 'present'],
    medium: ['Present Continuous', 'continuous'],
    hard: ['Present Simple vs Continuous', 'presentContrast'],
  },
  'B-Junior': {
    easy: ['Past Simple', 'past'],
    medium: ['Past Continuous', 'pastContinuous'],
    hard: ['Past Simple vs Continuous', 'pastContrast'],
  },
  'A-Senior': {
    easy: ['Present Perfect', 'perfect'],
    medium: ['Present Perfect vs Past Simple', 'perfectContrast'],
    hard: ['Modals', 'modal'],
  },
  'B-Senior': {
    easy: ['Passive Voice', 'passive'],
    medium: ['Conditionals', 'secondConditional'],
    hard: ['Conditionals', 'thirdConditional'],
  },
  'C-Junior': {
    easy: ['Cleft Sentences', 'cleft'],
    medium: ['Inversion', 'inversion'],
    hard: ['Inversion', 'advancedInversion'],
  },
  'C-Senior': {
    easy: ['Subjunctive', 'subjunctive'],
    medium: ['Conditionals', 'perfectConditional'],
    hard: ['Subjunctive', 'subjunctivePast'],
  },
};

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function presentForm(action, subject) {
  return subject.agreement === 'singular' ? action.third : action.base;
}

function perfectForm(action, subject) {
  return `${subject.agreement === 'singular' ? 'has' : 'have'} ${action.participle}`;
}

function makePrompt(level, difficulty, subject, action, cue, topic) {
  let questionText;
  let correct;
  let distractors;
  let explanation;

  switch (cue.type) {
    case 'present':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = presentForm(action, subject);
      distractors = [action.base, action.past, `is ${action.gerund}`];
      explanation = 'Use the present simple for a regular action; third-person singular subjects take the -s form.';
      break;
    case 'continuous':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = `${subject.agreement === 'singular' ? 'is' : 'are'} ${action.gerund}`;
      distractors = [presentForm(action, subject), `${subject.agreement === 'singular' ? 'was' : 'were'} ${action.gerund}`, perfectForm(action, subject)];
      explanation = 'Use the present continuous for an action happening now or around the present.';
      break;
    case 'presentContrast':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = cue.form === 'continuous'
        ? `${subject.agreement === 'singular' ? 'is' : 'are'} ${action.gerund}`
        : presentForm(action, subject);
      distractors = [cue.form === 'continuous' ? presentForm(action, subject) : `${subject.agreement === 'singular' ? 'is' : 'are'} ${action.gerund}`, action.past, perfectForm(action, subject)];
      explanation = 'A regular habit takes the present simple; an action happening now takes the present continuous.';
      break;
    case 'past':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = action.past;
      distractors = [action.base, action.participle, action.third];
      explanation = 'Use the past simple for a completed action at a definite time in the past.';
      break;
    case 'pastContinuous':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = `${subject.agreement === 'singular' ? 'was' : 'were'} ${action.gerund}`;
      distractors = [action.past, `${subject.agreement === 'singular' ? 'is' : 'are'} ${action.gerund}`, `had ${action.participle}`];
      explanation = 'Use the past continuous for an action in progress at a particular past time.';
      break;
    case 'pastContrast':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = cue.form === 'continuous'
        ? `${subject.agreement === 'singular' ? 'was' : 'were'} ${action.gerund}`
        : action.past;
      distractors = [cue.form === 'continuous' ? action.past : `${subject.agreement === 'singular' ? 'was' : 'were'} ${action.gerund}`, action.base, `had ${action.participle}`];
      explanation = 'A completed past action takes the past simple; an action in progress takes the past continuous.';
      break;
    case 'perfect':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = perfectForm(action, subject);
      distractors = [action.past, `${subject.agreement === 'singular' ? 'have' : 'has'} ${action.participle}`, `${subject.agreement === 'singular' ? 'is' : 'are'} ${action.gerund}`];
      explanation = 'Use the present perfect for an experience or action connected to the present.';
      break;
    case 'perfectContrast':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = cue.form === 'past' ? action.past : perfectForm(action, subject);
      distractors = [cue.form === 'past' ? perfectForm(action, subject) : action.past, action.base, `${subject.agreement === 'singular' ? 'is' : 'are'} ${action.gerund}`];
      explanation = 'A finished past time takes the past simple; an unfinished period or present connection takes the present perfect.';
      break;
    case 'modal':
      questionText = `${cue.text}, ${subject.phrase} ___ ${action.object}.`;
      correct = `${cue.modal} ${action.base}`;
      distractors = [
        `${cue.modal} to ${action.base}`,
        `${cue.modal} ${action.gerund}`,
        `${cue.modal}s ${action.base}`,
      ];
      explanation = `The context calls for the modal "${cue.modal}" to express its stated degree of necessity or possibility.`;
      break;
    case 'passive':
      questionText = `${action.object[0].toUpperCase()}${action.object.slice(1)} ___ by ${subject.phrase} ${cue.text.toLowerCase()}.`;
      correct = `is ${action.participle}`;
      distractors = [`${action.third}`, `was ${action.participle}`, `has ${action.participle}`];
      explanation = 'Use the passive when the action or its receiver is more important than the person doing it.';
      break;
    case 'secondConditional':
      questionText = `If ${subject.phrase} ___ ${action.object}, ${cue.text}.`;
      correct = action.past;
      distractors = [action.base, action.third, `would ${action.base}`];
      explanation = 'The second conditional uses a past form in the if-clause and would + base verb in the result.';
      break;
    case 'thirdConditional':
      questionText = `If ${subject.phrase} had ___ ${action.object} ${cue.text}, the outcome would have been different.`;
      correct = action.participle;
      distractors = [action.base, action.past, action.gerund];
      explanation = 'The third conditional uses had + past participle in the if-clause.';
      break;
    case 'cleft':
      questionText = `It was ${subject.phrase} ___ ${action.past} ${action.object} ${cue.text.toLowerCase()}.`;
      correct = 'who';
      distractors = ['which', 'where', 'whose'];
      explanation = 'Use "who" in a cleft sentence to emphasize a person.';
      break;
    case 'inversion':
      questionText = `${cue.text} ___ ${subject.phrase} ${action.participle} ${action.object} so carefully.`;
      correct = `${subject.agreement === 'singular' ? 'has' : 'have'} ${subject.phrase}`;
      distractors = [`${subject.phrase} has`, `${subject.agreement === 'singular' ? 'is' : 'are'} ${subject.phrase}`, `${subject.agreement === 'singular' ? 'does' : 'do'} ${subject.phrase}`];
      explanation = 'Negative or restrictive adverbials at the beginning of a sentence require auxiliary-subject inversion.';
      break;
    case 'advancedInversion':
      questionText = `${cue.text} ___ ${subject.phrase} ${action.base} ${action.object}.`;
      correct = 'did';
      distractors = ['does', 'has', 'was'];
      explanation = 'After "Not until" at the beginning of a sentence, use auxiliary-subject inversion and the base verb.';
      break;
    case 'subjunctive':
      questionText = `${cue.text} ${subject.phrase} ___ ${action.object}.`;
      correct = action.base;
      distractors = [action.third, action.past, `to ${action.base}`];
      explanation = 'Mandative subjunctive clauses use the base form of the verb after verbs such as recommend, insist, and require.';
      break;
    case 'perfectConditional':
      questionText = `If ${subject.phrase} had more time ${cue.text}, ___ ${action.object}.`;
      correct = `${subject.phrase} would ${action.base}`;
      distractors = [`${subject.phrase} will ${action.base}`, `${subject.phrase} would have ${action.participle}`, `${subject.phrase} had ${action.base}`];
      explanation = 'The second conditional uses would + base verb in its result clause.';
      break;
    case 'subjunctivePast':
      questionText = `${cue.text} ${subject.phrase} ___ ${action.object} before publication.`;
      correct = action.base;
      distractors = [action.third, action.past, `will ${action.base}`];
      explanation = 'Formal recommendations and requirements use the base-form subjunctive, even with a singular subject.';
      break;
    default:
      throw new Error(`Unknown question profile: ${cue.type}`);
  }

  const options = [...new Set([correct, ...distractors])];
  const additionalOptions = [
    `will ${action.base}`,
    `has ${action.participle}`,
    `${subject.agreement === 'singular' ? 'is' : 'are'} ${action.gerund}`,
    `to ${action.base}`,
  ];
  for (const option of additionalOptions) {
    if (options.length === 4) break;
    if (!options.includes(option)) options.push(option);
  }
  if (options.length !== 4) return null;

  const orderedOptions = options.sort((a, b) =>
    hash(`${questionText}|${a}`).localeCompare(hash(`${questionText}|${b}`))
  );
  const questionId = `generated-${hash(`${level}|${difficulty}|${questionText}`).slice(0, 40)}`;
  return {
    id: questionId,
    level,
    difficulty,
    topicSyllabusTag: topic,
    questionText,
    options: JSON.stringify(orderedOptions),
    correctAnswer: orderedOptions.indexOf(correct),
    explanation,
    points: difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3,
  };
}

function getCues(type) {
  if (type === 'presentContrast') {
    return [
      ...CUES.present.map((text) => ({ text, form: 'simple' })),
      ...CUES.continuous.map((text) => ({ text, form: 'continuous' })),
    ];
  }
  if (type === 'pastContrast') {
    return [
      ...CUES.simplePastContrast.map((text) => ({ text, form: 'simple' })),
      ...CUES.pastContinuous.map((text) => ({ text, form: 'continuous' })),
    ];
  }
  if (type === 'perfectContrast') {
    return [
      ...CUES.perfectContrast.map((text, index) => ({
        text,
        form: [0, 1, 4, 6].includes(index) ? 'perfect' : 'past',
      })),
    ];
  }
  if (type === 'modal') {
    return CUES.modal.map((text, index) => ({
      text,
      modal: ['must', 'must', 'must', 'should', 'might', 'must', 'must', 'should'][index],
    }));
  }
  if (type === 'secondConditional') {
    return CUES.conditionalResults.map((text) => ({ text }));
  }
  const cueKey = {
    present: 'present',
    continuous: 'continuous',
    past: 'past',
    pastContinuous: 'pastContinuous',
    perfect: 'perfect',
    passive: 'passive',
    secondConditional: 'secondConditional',
    subjunctive: 'subjunctive',
    subjunctivePast: 'subjunctive',
    inversion: 'inversion',
    advancedInversion: 'inversion',
    thirdConditional: 'thirdConditional',
    cleft: 'past',
    perfectConditional: 'moreTime',
  }[type];
  if (type === 'advancedInversion') {
    return CUES.advancedInversion.map((text) => ({ text }));
  }
  return CUES[cueKey].map((text) => ({ text }));
}

function makeCue(type, cue) {
  if (type === 'presentContrast') return { ...cue, type };
  if (type === 'pastContrast') return { ...cue, type };
  if (type === 'perfectContrast') return { ...cue, type };
  return { ...cue, type };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const diversifyOnly = process.argv.includes('--diversify-only');
  const totals = await prisma.question.count();
  if (totals > TARGET_TOTAL && !diversifyOnly) {
    throw new Error(`Question bank already exceeds target: ${totals} > ${TARGET_TOTAL}`);
  }

  const existing = await prisma.question.findMany({
    select: { id: true, level: true, difficulty: true, questionText: true },
  });
  const existingIds = new Set(existing.map((question) => question.id));
  const existingText = new Set(existing.map((question) => question.questionText.trim().toLowerCase()));
  const counts = await prisma.question.groupBy({
    by: ['level', 'difficulty'],
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((row) => [`${row.level}|${row.difficulty}`, row._count._all]));

  const perBucket = Math.floor(TARGET_TOTAL / (LEVELS.length * DIFFICULTIES.length));
  const remainder = TARGET_TOTAL % (LEVELS.length * DIFFICULTIES.length);
  const pending = [];
  let bucketIndex = 0;

  for (const level of LEVELS) {
    for (const difficulty of DIFFICULTIES) {
      const desired = perBucket + (bucketIndex < remainder ? 1 : 0);
      const current = countMap.get(`${level}|${difficulty}`) || 0;
      const needed = diversifyOnly ? 0 : Math.max(0, desired - current);
      bucketIndex++;
      if (needed === 0) continue;

      const [topic, profile] = CONFIG[level][difficulty];
      const cues = getCues(profile);
      let generated = 0;

      for (let cueIndex = 0; cueIndex < cues.length && generated < needed; cueIndex++) {
        const cue = makeCue(profile, cues[cueIndex]);
        for (let subjectIndex = 0; subjectIndex < SUBJECTS.length && generated < needed; subjectIndex++) {
          const subject = SUBJECTS[subjectIndex];
          for (let actionIndex = 0; actionIndex < ACTIONS.length && generated < needed; actionIndex++) {
            const action = ACTIONS[actionIndex];
            const question = makePrompt(level, difficulty, subject, action, cue, topic);
            if (!question) continue;
            const normalizedText = question.questionText.trim().toLowerCase();
            if (existingIds.has(question.id) || existingText.has(normalizedText)) continue;
            existingIds.add(question.id);
            existingText.add(normalizedText);
            pending.push(question);
            generated++;
          }
        }
      }

      if (generated !== needed) {
        throw new Error(`${level}/${difficulty}: generated ${generated} of ${needed} required questions`);
      }
      console.log(`${level} / ${difficulty}: adding ${generated}`);
    }
  }

  if (dryRun) {
    console.log(`Dry run: ${pending.length} unique questions ready; bank total would be ${totals + pending.length}.`);
    console.log('Sample questions by level/difficulty:');
    const sampledBuckets = new Set();
    pending.forEach((question) => {
      const bucket = `${question.level}|${question.difficulty}`;
      if (sampledBuckets.has(bucket)) return;
      sampledBuckets.add(bucket);
      console.log(`- [${question.level}/${question.difficulty}] ${question.questionText} ${question.options} (answer ${question.correctAnswer})`);
    });
    return;
  }

  const batchSize = 1000;
  for (let start = 0; start < pending.length; start += batchSize) {
    await prisma.question.createMany({ data: pending.slice(start, start + batchSize) });
    console.log(`Inserted ${Math.min(start + batchSize, pending.length)} / ${pending.length}`);
  }

  const diversity = await diversifyQuestionBank(prisma);
  console.log(`Diversified ${diversity.convertedQuestionCount} questions across ${diversity.generatedQuestionCount} generated questions.`);

  const finalCount = await prisma.question.count();
  if (!diversifyOnly && finalCount !== TARGET_TOTAL) {
    throw new Error(`Expected ${TARGET_TOTAL} questions after generation; found ${finalCount}`);
  }
  console.log(`Question bank contains ${finalCount} questions.`);
}

main()
  .catch((error) => {
    console.error('Question bank generation failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
