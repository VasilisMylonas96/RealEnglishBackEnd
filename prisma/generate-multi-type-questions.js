/**
 * Multi-type question generator — 100,000 questions PER TYPE.
 *
 * Brings every new question type (SENTENCE_ORDERING, FILL_IN_THE_BLANK,
 * ERROR_CORRECTION, SYNONYM_ANTONYM, TRUE_FALSE) up to 100,000 total
 * (~16,667 per CEFR level). The bank already holds 100,000 MULTIPLE_CHOICE.
 *
 * How it reaches 100k per type:
 *   - A CEFR-graded sentence bank is built per level from grammar templates
 *     (subject × action × time).
 *   - From each sentence, MULTIPLE variants are derived by blanking or
 *     corrupting different slots (verb / object / time / subject):
 *       FILL_IN_THE_BLANK  → blank the verb, the object, the time, or the subject
 *       ERROR_CORRECTION   → corrupt the verb, the object, the time, or the subject
 *       TRUE_FALSE         → "is this sentence correct?" (correct + corrupted)
 *       SENTENCE_ORDERING  → shuffle the words
 *       SYNONYM_ANTONYM    → synonym (from the action) + antonym (adjective pairs)
 *   - Generation is incremental: it reads the current per-level/per-type counts
 *     and only adds the difference, deduplicating against existing text.
 *
 * Usage:
 *   node prisma/generate-multi-type-questions.js            # run
 *   node prisma/generate-multi-type-questions.js --dry-run  # preview only
 */
require('dotenv').config();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CEFR_LEVELS = [
  { cefr: 'A1', level: 'A-Junior' },
  { cefr: 'A2', level: 'B-Junior' },
  { cefr: 'B1', level: 'A-Senior' },
  { cefr: 'B2', level: 'B-Senior' },
  { cefr: 'C1', level: 'C-Junior' },
  { cefr: 'C2', level: 'C-Senior' },
];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const POINTS = { easy: 10, medium: 20, hard: 30 };

// 100,000 per type, split across the 6 levels.
const TYPE_TOTAL = 100000;
const TARGET_TYPES = ['SENTENCE_ORDERING', 'FILL_IN_THE_BLANK', 'ERROR_CORRECTION', 'SYNONYM_ANTONYM', 'TRUE_FALSE'];

// ─── Content pools ───────────────────────────────────────────────────────────

const SUBJECTS = [
  ['my brother', 'singular'], ['my sister', 'singular'], ['the teacher', 'singular'],
  ['the students', 'plural'], ['our neighbors', 'plural'], ['the new student', 'singular'],
  ['the school team', 'singular'], ['the researchers', 'plural'], ['a careful editor', 'singular'],
  ['the young musicians', 'plural'], ['my grandparents', 'plural'], ['the local librarian', 'singular'],
  ['the volunteers', 'plural'], ['a group of friends', 'singular'], ['the class', 'singular'],
  ['the children', 'plural'], ['our science teacher', 'singular'], ['the office staff', 'singular'],
  ['a skilled mechanic', 'singular'], ['the writers', 'plural'], ['the project manager', 'singular'],
  ['the nurses', 'plural'], ['a team of designers', 'singular'], ['the committee members', 'plural'],
  ['the university lecturer', 'singular'], ['the journalists', 'plural'], ['my cousin', 'singular'],
  ['the language learners', 'plural'], ['the museum guide', 'singular'], ['the engineers', 'plural'],
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
  third: base.endsWith('y') ? `${base.slice(0, -1)}ies` : `${base}${['ch', 'sh', 'ss', 'x', 'o'].some((e) => base.endsWith(e)) ? 'es' : 's'}`,
  past,
  participle,
  gerund,
  object,
}));

const TIMES = [
  'every morning', 'on school days', 'usually', 'each week', 'at the start of term',
  'most afternoons', 'on busy days', 'as a regular habit', 'before each lesson',
  'during the school year', 'every Friday', 'in the early morning', 'after lunch',
  'at the end of each month', 'whenever there is enough time',
];

const PAST_TIMES = [
  'yesterday', 'last week', 'a year ago', 'on Monday', 'during the previous term',
  'earlier that morning', 'a few days ago', 'at the end of last month',
  'in the previous lesson', 'before the holidays', 'last winter', 'during the last meeting',
  'in 2022', 'the day before yesterday', 'at the start of the project',
];

const PERFECT_TIMES = [
  'so far this term', 'in the last few weeks', 'since September', 'over the past year',
  'up to now', 'recently', 'during their time at the school', 'for several months',
  'since the project began', 'in the last decade', 'already this morning', 'over the years',
  'for a long time', 'since the new course started', 'to date',
];

const INVERSION_TIMES = [
  'so far this term', 'in the last few weeks', 'since September', 'over the past year',
  'up to now', 'recently', 'for several months', 'since the project began',
  'in the last decade', 'already this morning', 'over the years', 'for a long time',
  'since the new course started', 'to date', 'this term', 'this year',
];

const ADJECTIVES = [
  ['happy', 'sad'], ['big', 'small'], ['hot', 'cold'], ['fast', 'slow'],
  ['easy', 'difficult'], ['old', 'young'], ['tall', 'short'], ['clean', 'dirty'],
  ['loud', 'quiet'], ['rich', 'poor'], ['strong', 'weak'], ['early', 'late'],
  ['bright', 'dark'], ['good', 'bad'], ['simple', 'complex'], ['kind', 'rude'],
  ['brave', 'afraid'], ['busy', 'free'], ['warm', 'cool'], ['narrow', 'wide'],
  ['heavy', 'light'], ['deep', 'shallow'], ['thick', 'thin'], ['soft', 'hard'],
  ['sweet', 'bitter'], ['smooth', 'rough'], ['fresh', 'stale'], ['full', 'empty'],
  ['open', 'closed'], ['alive', 'dead'], ['wet', 'dry'], ['sharp', 'dull'],
  ['generous', 'stingy'], ['honest', 'dishonest'], ['patient', 'impatient'], ['modest', 'arrogant'],
];

const NOUNS = [
  'the house', 'the car', 'the book', 'the garden', 'the city', 'the film',
  'the song', 'the meal', 'the journey', 'the meeting', 'the plan', 'the gift',
  'the letter', 'the photo', 'the story', 'the game', 'the lesson', 'the project',
  'the answer', 'the question', 'the road', 'the river', 'the mountain', 'the beach',
  'the market', 'the hospital', 'the airport', 'the library', 'the kitchen', 'the bedroom',
  'the classroom', 'the playground', 'the office', 'the factory', 'the farm', 'the village',
  'the country', 'the world', 'the day', 'the week', 'the month', 'the year',
  'the morning', 'the evening', 'the night', 'the season', 'the weather', 'the sky',
  'the sun', 'the moon', 'the star', 'the tree', 'the flower', 'the fruit',
];

const ANTONYM_FRAMES = [
  'NOUN is ADJ today.',
  'NOUN is ADJ.',
  'Today NOUN is ADJ.',
  'NOUN looks ADJ.',
  'NOUN feels ADJ.',
];

const SYNONYM_ACTIONS = [
  { base: 'check', synonym: 'inspect' }, { base: 'prepare', synonym: 'arrange' },
  { base: 'visit', synonym: 'explore' }, { base: 'organize', synonym: 'arrange' },
  { base: 'study', synonym: 'learn' }, { base: 'write', synonym: 'compose' },
  { base: 'choose', synonym: 'select' }, { base: 'build', synonym: 'construct' },
  { base: 'teach', synonym: 'instruct' }, { base: 'make', synonym: 'create' },
  { base: 'send', synonym: 'dispatch' }, { base: 'bring', synonym: 'carry' },
  { base: 'explain', synonym: 'clarify' }, { base: 'review', synonym: 'assess' },
  { base: 'design', synonym: 'plan' }, { base: 'repair', synonym: 'fix' },
  { base: 'discuss', synonym: 'debate' }, { base: 'publish', synonym: 'release' },
  { base: 'analyze', synonym: 'examine' }, { base: 'develop', synonym: 'improve' },
  { base: 'find', synonym: 'discover' }, { base: 'give', synonym: 'provide' },
  { base: 'speak', synonym: 'talk' }, { base: 'drive', synonym: 'operate' },
  { base: 'take', synonym: 'record' }, { base: 'see', synonym: 'notice' },
  { base: 'paint', synonym: 'decorate' }, { base: 'clean', synonym: 'wash' },
  { base: 'compare', synonym: 'contrast' }, { base: 'collect', synonym: 'gather' },
];

const IRREGULAR_VERBS = [
  ['go', 'went', 'gone'], ['be', 'was', 'been'], ['have', 'had', 'had'], ['do', 'did', 'done'],
  ['say', 'said', 'said'], ['get', 'got', 'got'], ['make', 'made', 'made'], ['know', 'knew', 'known'],
  ['think', 'thought', 'thought'], ['take', 'took', 'taken'], ['see', 'saw', 'seen'], ['come', 'came', 'come'],
  ['give', 'gave', 'given'], ['tell', 'told', 'told'], ['find', 'found', 'found'], ['become', 'became', 'become'],
  ['leave', 'left', 'left'], ['feel', 'felt', 'felt'], ['put', 'put', 'put'], ['mean', 'meant', 'meant'],
  ['keep', 'kept', 'kept'], ['let', 'let', 'let'], ['begin', 'began', 'begun'], ['seem', 'seemed', 'seemed'],
  ['help', 'helped', 'helped'], ['show', 'showed', 'shown'], ['hear', 'heard', 'heard'], ['play', 'played', 'played'],
  ['run', 'ran', 'run'], ['move', 'moved', 'moved'], ['live', 'lived', 'lived'], ['believe', 'believed', 'believed'],
  ['bring', 'brought', 'brought'], ['happen', 'happened', 'happened'], ['write', 'wrote', 'written'], ['sit', 'sat', 'sat'],
  ['stand', 'stood', 'stood'], ['lose', 'lost', 'lost'], ['pay', 'paid', 'paid'], ['meet', 'met', 'met'],
  ['learn', 'learned', 'learned'], ['understand', 'understood', 'understood'], ['watch', 'watched', 'watched'], ['read', 'read', 'read'],
  ['lead', 'led', 'led'], ['ride', 'rode', 'ridden'], ['speak', 'spoke', 'spoken'], ['break', 'broke', 'broken'],
  ['buy', 'bought', 'bought'], ['catch', 'caught', 'caught'], ['drive', 'drove', 'driven'], ['eat', 'ate', 'eaten'],
  ['fall', 'fell', 'fallen'], ['fight', 'fought', 'fought'], ['fly', 'flew', 'flown'], ['forget', 'forgot', 'forgotten'],
  ['grow', 'grew', 'grown'], ['hit', 'hit', 'hit'], ['jump', 'jumped', 'jumped'], ['kick', 'kicked', 'kicked'],
  ['laugh', 'laughed', 'laughed'], ['lend', 'lent', 'lent'], ['light', 'lit', 'lit'], ['look', 'looked', 'looked'],
  ['love', 'loved', 'loved'], ['marry', 'married', 'married'], ['open', 'opened', 'opened'], ['pass', 'passed', 'passed'],
  ['pick', 'picked', 'picked'], ['plan', 'planned', 'planned'], ['pull', 'pulled', 'pulled'], ['push', 'pushed', 'pushed'],
  ['reach', 'reached', 'reached'], ['remain', 'remained', 'remained'], ['rise', 'rose', 'risen'], ['sell', 'sold', 'sold'],
  ['shoot', 'shot', 'shot'], ['sleep', 'slept', 'slept'], ['smile', 'smiled', 'smiled'], ['sort', 'sorted', 'sorted'],
  ['spread', 'spread', 'spread'], ['spring', 'sprang', 'sprung'], ['steal', 'stole', 'stolen'], ['step', 'stepped', 'stepped'],
  ['swim', 'swam', 'swum'], ['teach', 'taught', 'taught'], ['throw', 'threw', 'thrown'], ['touch', 'touched', 'touched'],
  ['train', 'trained', 'trained'], ['travel', 'traveled', 'traveled'], ['turn', 'turned', 'turned'], ['wake', 'woke', 'woken'],
  ['walk', 'walked', 'walked'], ['wear', 'wore', 'worn'], ['win', 'won', 'won'], ['work', 'worked', 'worked'],
  ['wrap', 'wrapped', 'wrapped'], ['wonder', 'wondered', 'wondered'],
  ['arise', 'arose', 'arisen'], ['awake', 'woke', 'woken'], ['bear', 'bore', 'borne'], ['beat', 'beat', 'beaten'],
  ['bind', 'bound', 'bound'], ['bite', 'bit', 'bitten'], ['bleed', 'bled', 'bled'], ['blow', 'blew', 'blown'],
  ['breed', 'bred', 'bred'], ['burst', 'burst', 'burst'], ['cling', 'clung', 'clung'], ['creep', 'crept', 'crept'],
  ['dig', 'dug', 'dug'], ['draw', 'drew', 'drawn'], ['dream', 'dreamt', 'dreamt'], ['drink', 'drank', 'drunk'],
  ['feed', 'fed', 'fed'], ['forgive', 'forgave', 'forgiven'], ['freeze', 'froze', 'frozen'], ['grind', 'ground', 'ground'],
  ['hang', 'hung', 'hung'], ['hide', 'hid', 'hidden'], ['hold', 'held', 'held'], ['hurt', 'hurt', 'hurt'],
  ['knit', 'knit', 'knit'], ['lay', 'laid', 'laid'], ['lean', 'leaned', 'leaned'], ['leap', 'leapt', 'leapt'],
  ['lie', 'lay', 'lain'], ['prove', 'proved', 'proven'], ['quit', 'quit', 'quit'], ['ring', 'rang', 'rung'],
  ['sew', 'sewed', 'sewn'], ['shake', 'shook', 'shaken'], ['shine', 'shone', 'shone'], ['shut', 'shut', 'shut'],
  ['sing', 'sang', 'sung'], ['sink', 'sank', 'sunk'], ['slide', 'slid', 'slid'], ['sling', 'slung', 'slung'],
  ['smite', 'smote', 'smitten'], ['sow', 'sowed', 'sown'], ['spell', 'spelt', 'spelt'], ['spend', 'spent', 'spent'],
  ['spin', 'spun', 'spun'], ['spit', 'spat', 'spat'], ['split', 'split', 'split'], ['sting', 'stung', 'stung'],
  ['stink', 'stank', 'stunk'], ['strike', 'struck', 'struck'], ['string', 'strung', 'strung'], ['swing', 'swung', 'swung'],
  ['tear', 'tore', 'torn'], ['thrust', 'thrust', 'thrust'], ['weave', 'wove', 'woven'], ['weep', 'wept', 'wept'],
  ['wind', 'wound', 'wound'], ['withdraw', 'withdrew', 'withdrawn'], ['withhold', 'withheld', 'withheld'],
];

// Per-level grammar profiles: easy / medium / hard → template key.
const LEVEL_PROFILES = {
  A1: { easy: 'present', medium: 'continuous', hard: 'past' },
  A2: { easy: 'past', medium: 'pastContinuous', hard: 'perfect' },
  B1: { easy: 'perfect', medium: 'passive', hard: 'conditional2' },
  B2: { easy: 'conditional2', medium: 'passive', hard: 'conditional3' },
  C1: { easy: 'conditional3', medium: 'inversion', hard: 'subjunctive' },
  C2: { easy: 'subjunctive', medium: 'inversion', hard: 'conditional3' },
};

const TOPIC_BY_TEMPLATE = {
  present: 'Present Simple',
  continuous: 'Present Continuous',
  past: 'Past Simple',
  pastContinuous: 'Past Continuous',
  perfect: 'Present Perfect',
  passive: 'Passive Voice',
  conditional2: 'Second Conditional',
  conditional3: 'Third Conditional',
  inversion: 'Inversion',
  subjunctive: 'Subjunctive',
};

const TOPIC_RULES = {
  'Present Simple': 'Use the present simple for regular habits and facts; third-person singular subjects take the -s form.',
  'Present Continuous': 'Use the present continuous for actions happening now or around the present.',
  'Past Simple': 'Use the past simple for a completed action at a definite time in the past.',
  'Past Continuous': 'Use the past continuous for an action in progress at a particular past time.',
  'Present Perfect': 'Use the present perfect for an experience or action connected to the present.',
  'Passive Voice': 'Use the passive when the receiver of the action is more important than the person doing it.',
  'Second Conditional': 'The second conditional uses a past form in the if-clause and would + base verb in the result.',
  'Third Conditional': 'The third conditional uses had + past participle in the if-clause and would have + past participle in the result.',
  'Inversion': 'Negative or restrictive adverbials at the start of a sentence require auxiliary-subject inversion.',
  'Subjunctive': 'Mandative subjunctive clauses use the base form of the verb after verbs such as recommend, insist, and require.',
  'Irregular Verbs': 'Irregular verbs do not take -ed in the past; memorize their unique past forms.',
  'Vocabulary': 'Choose the word that best matches the meaning in context.',
  'General': 'Apply the grammar and vocabulary rules covered in this topic.',
};

function explanationFor(type, topic, mode, correctAnswer) {
  const rule = TOPIC_RULES[topic] || TOPIC_RULES.General;
  if (type === 'SENTENCE_ORDERING') return `Arrange the words to form a correct sentence. ${rule}`;
  if (type === 'ERROR_CORRECTION') return `The marked word breaks the rule: ${rule.toLowerCase()}`;
  if (type === 'SYNONYM_ANTONYM') return mode === 'ANTONYM'
    ? 'The correct option is the opposite (antonym) of the target word in this context.'
    : 'The correct option is the closest synonym of the target word in this context.';
  if (type === 'TRUE_FALSE') return correctAnswer === 0
    ? 'The statement is true — the forms shown follow the rule for this topic.'
    : 'The statement is false — review the actual rule for this topic.';
  return rule;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function tokenize(sentence) {
  return sentence.replace(/[.,;:!?]/g, '').match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) || [];
}

function stableShuffle(items, seed) {
  return items
    .map((value, index) => ({ value, rank: hash(`${seed}|${index}|${value}`) }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map((item) => item.value);
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dedupe(items) {
  return [...new Set(items.map((i) => i.trim()))].filter(Boolean);
}

function pickDistractors(pool, exclude, count, seed) {
  const candidates = pool.filter((x) => x !== exclude);
  return stableShuffle(candidates, seed).slice(0, count);
}

function findTokenIndex(sentence, text) {
  const tokens = tokenize(sentence);
  const slotTokens = tokenize(text);
  if (!slotTokens.length) return -1;
  for (let i = 0; i <= tokens.length - slotTokens.length; i++) {
    let match = true;
    for (let j = 0; j < slotTokens.length; j++) {
      if (tokens[i + j] !== slotTokens[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

// Build a canonical sentence + the verb answer span + verb distractors.
function buildSentence(template, subject, action, time) {
  const sing = subject.agreement === 'singular';
  const be = sing ? 'is' : 'are';
  const bePast = sing ? 'was' : 'were';
  const has = sing ? 'has' : 'have';

  switch (template) {
    case 'present':
      return {
        sentence: `${subject.phrase} ${sing ? action.third : action.base} ${action.object} ${time}.`,
        verb: sing ? action.third : action.base,
        verbDistractors: [action.past, `${be} ${action.gerund}`, `${has} ${action.participle}`],
      };
    case 'continuous':
      return {
        sentence: `${cap(time)}, ${subject.phrase} ${be} ${action.gerund} ${action.object}.`,
        verb: `${be} ${action.gerund}`,
        verbDistractors: [sing ? action.third : action.base, `${bePast} ${action.gerund}`, `${has} ${action.participle}`],
      };
    case 'past':
      return {
        sentence: `${cap(time)}, ${subject.phrase} ${action.past} ${action.object}.`,
        verb: action.past,
        verbDistractors: [action.base, action.participle, sing ? action.third : action.base],
      };
    case 'pastContinuous':
      return {
        sentence: `${cap(time)}, ${subject.phrase} ${bePast} ${action.gerund} ${action.object}.`,
        verb: `${bePast} ${action.gerund}`,
        verbDistractors: [action.past, `${be} ${action.gerund}`, `${has} ${action.participle}`],
      };
    case 'perfect':
      return {
        sentence: `${cap(time)}, ${subject.phrase} ${has} ${action.participle} ${action.object}.`,
        verb: `${has} ${action.participle}`,
        verbDistractors: [action.past, `${be} ${action.gerund}`, `${has} ${action.base}`],
      };
    case 'passive':
      return {
        sentence: `${cap(action.object)} ${be} ${action.participle} by ${subject.phrase} ${time}.`,
        verb: `${be} ${action.participle}`,
        verbDistractors: [sing ? action.third : action.base, `was ${action.participle}`, `${has} ${action.participle}`],
      };
    case 'conditional2':
      return {
        sentence: `If ${subject.phrase} ${action.past} ${action.object} ${time}, the result would be different.`,
        verb: action.past,
        verbDistractors: [action.base, sing ? action.third : action.base, `would ${action.base}`],
      };
    case 'conditional3':
      return {
        sentence: `If ${subject.phrase} had ${action.participle} ${action.object} ${time}, the outcome would have been different.`,
        verb: `had ${action.participle}`,
        verbDistractors: [action.past, `has ${action.participle}`, `would ${action.base}`],
      };
    case 'inversion':
      return {
        sentence: `Rarely ${has} ${subject.phrase} ${action.participle} ${action.object} ${time}.`,
        verb: `${has} ${subject.phrase}`,
        verbDistractors: [`${subject.phrase} ${has}`, `${be} ${subject.phrase}`, `does ${subject.phrase}`],
      };
    case 'subjunctive':
      return {
        sentence: `The committee recommends that ${subject.phrase} ${action.base} ${action.object} ${time}.`,
        verb: action.base,
        verbDistractors: [sing ? action.third : action.base, action.past, `to ${action.base}`],
      };
    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

// Extract the blankable/corruptable slots of a sentence.
function getSlots(template, subject, action, time, timePool) {
  const built = buildSentence(template, subject, action, time);
  const atStart = ['continuous', 'past', 'pastContinuous', 'perfect'].includes(template);
  const timeText = atStart ? cap(time) : time;
  const timePoolTexts = timePool.map((t) => (atStart ? cap(t) : t));

  const slots = [
    { kind: 'verb', text: built.verb, distractors: built.verbDistractors.filter((d) => d && d !== built.verb) },
    { kind: 'object', text: action.object, distractors: pickDistractors(ACTIONS.map((a) => a.object), action.object, 3, `obj|${action.object}`) },
    { kind: 'time', text: timeText, distractors: pickDistractors(timePoolTexts, timeText, 3, `time|${time}`) },
    { kind: 'subject', text: subject.phrase, distractors: pickDistractors(SUBJECTS.map((s) => s.phrase), subject.phrase, 3, `subj|${subject.phrase}`) },
  ];
  return { sentence: built.sentence, slots };
}

// ─── Question builders (return null when the variant can't yield a valid item) ─

function makeSO(combo) {
  const clean = combo.sentence.replace(/[.,;:!?]/g, '').trim();
  const tokens = tokenize(clean);
  if (tokens.length < 4) return null;
  const shuffled = stableShuffle(tokens, `so|${clean}`);
  if (shuffled.every((t, i) => t === tokens[i])) shuffled.push(shuffled.shift());
  return {
    questionType: 'SENTENCE_ORDERING',
    questionText: `Put the words in the correct order: ${clean}`,
    options: shuffled,
    correctAnswer: 0,
    correctAnswerText: JSON.stringify(tokens),
    questionData: null,
    topic: combo.topic,
  };
}

function makeFIB(combo, slot) {
  if (!combo.sentence.includes(slot.text)) return null;
  const blanked = combo.sentence.replace(slot.text, '___');
  const options = dedupe([slot.text, ...slot.distractors]).slice(0, 4);
  if (options.length < 3) return null;
  const ordered = stableShuffle(options, `fib|${blanked}|${slot.text}`);
  return {
    questionType: 'FILL_IN_THE_BLANK',
    questionText: `Complete the sentence: ${blanked}`,
    options: ordered,
    correctAnswer: ordered.indexOf(slot.text),
    correctAnswerText: slot.text,
    questionData: { sentenceParts: [blanked] },
    topic: combo.topic,
  };
}

function makeEC(combo, slot) {
  const wrong = slot.distractors.find((d) => d && d !== slot.text);
  if (!wrong) return null;
  const incorrect = combo.sentence.replace(slot.text, wrong);
  const idx = findTokenIndex(incorrect, wrong);
  if (idx < 0) return null;
  const tokens = tokenize(incorrect);
  const wrongTokens = tokenize(wrong);
  return {
    questionType: 'ERROR_CORRECTION',
    questionText: `Find and correct the error: ${incorrect}`,
    options: tokens,
    correctAnswer: idx,
    correctAnswerText: wrongTokens[0],
    questionData: { correction: slot.text },
    topic: combo.topic,
  };
}

function makeTF(combo, isCorrect) {
  if (isCorrect) {
    return {
      questionType: 'TRUE_FALSE',
      questionText: `Is this sentence grammatically correct? ${combo.sentence}`,
      options: ['True', 'False'],
      correctAnswer: 0,
      correctAnswerText: 'True',
      questionData: null,
      topic: combo.topic,
    };
  }
  const verbSlot = combo.slots.find((s) => s.kind === 'verb');
  const wrong = verbSlot.distractors.find((d) => d && d !== verbSlot.text);
  if (!wrong) return null;
  const incorrect = combo.sentence.replace(verbSlot.text, wrong);
  return {
    questionType: 'TRUE_FALSE',
    questionText: `Is this sentence grammatically correct? ${incorrect}`,
    options: ['True', 'False'],
    correctAnswer: 1,
    correctAnswerText: 'False',
    questionData: null,
    topic: combo.topic,
  };
}

function makeSynonym(combo, syn) {
  const distractors = SYNONYM_ACTIONS
    .filter((s) => s.base !== syn.base && s.synonym !== syn.synonym)
    .map((s) => s.synonym);
  const options = dedupe([syn.synonym, ...stableShuffle(distractors, `syn|${syn.base}`)].slice(0, 4));
  if (options.length < 3) return null;
  const ordered = stableShuffle(options, `syn|${combo.sentence}|${syn.base}`);
  return {
    questionType: 'SYNONYM_ANTONYM',
    questionText: `In "${combo.sentence}", which word is closest in meaning to "${syn.base}"?`,
    options: ordered,
    correctAnswer: ordered.indexOf(syn.synonym),
    correctAnswerText: syn.synonym,
    questionData: { targetWord: syn.base, mode: 'SYNONYM' },
    topic: 'Vocabulary',
  };
}

function makeAntonym(word, opposite, noun, frame) {
  const sentence = frame.replace('NOUN', noun).replace('ADJ', word);
  const distractors = ADJECTIVES
    .filter((p) => p[0] !== word && p[1] !== word && p[0] !== opposite && p[1] !== opposite)
    .map((p) => p[0]);
  const options = dedupe([opposite, ...stableShuffle(distractors, `ant|${word}`)].slice(0, 4));
  if (options.length < 3) return null;
  const ordered = stableShuffle(options, `ant|${sentence}|${word}`);
  return {
    questionType: 'SYNONYM_ANTONYM',
    questionText: `In "${sentence}", which word is the opposite of "${word}"?`,
    options: ordered,
    correctAnswer: ordered.indexOf(opposite),
    correctAnswerText: opposite,
    questionData: { targetWord: word, mode: 'ANTONYM' },
    topic: 'Vocabulary',
  };
}

function makeVerbTF(verb, variant) {
  const [base, past, participle] = verb;
  let statement;
  let isTrue;
  switch (variant) {
    case 0: statement = `The past simple of "${base}" is "${past}".`; isTrue = true; break;
    case 1: statement = `The past simple of "${base}" is "${base}ed".`; isTrue = past !== `${base}ed`; break;
    case 2: statement = `The past participle of "${base}" is "${participle}".`; isTrue = true; break;
    case 3: statement = `The past participle of "${base}" is "${base}en".`; isTrue = participle === `${base}en`; break;
    case 4: statement = `"${base}" is a regular verb.`; isTrue = past === `${base}ed` && participle === `${base}ed`; break;
    case 5: statement = `The past simple of "${base}" is the same as its base form.`; isTrue = past === base; break;
    case 6: statement = `The past participle of "${base}" is the same as its past simple.`; isTrue = participle === past; break;
    case 7: statement = `"${base}" changes form in the past simple.`; isTrue = past !== base; break;
    case 8: statement = `The base form of "${base}" is "${base}".`; isTrue = true; break;
    case 9: statement = `The past simple of "${base}" is "${participle}".`; isTrue = past === participle; break;
    case 10: statement = `"${base}" is an irregular verb.`; isTrue = past !== `${base}ed` || participle !== `${base}ed`; break;
    case 11: statement = `The past participle of "${base}" ends in "-en".`; isTrue = participle.endsWith('en'); break;
    default: return null;
  }
  return {
    questionType: 'TRUE_FALSE',
    questionText: `True or False: ${statement}`,
    options: ['True', 'False'],
    correctAnswer: isTrue ? 0 : 1,
    correctAnswerText: isTrue ? 'True' : 'False',
    questionData: null,
    topic: 'Irregular Verbs',
  };
}

function finalize(q, level, cefr, difficulty) {
  const mode = q.questionData && q.questionData.mode;
  return {
    level,
    cefrLevel: cefr,
    difficulty,
    questionType: q.questionType,
    topicSyllabusTag: q.topic,
    questionText: q.questionText,
    options: JSON.stringify(q.options),
    questionData: q.questionData ? JSON.stringify(q.questionData) : null,
    correctAnswer: q.correctAnswer,
    correctAnswerText: q.correctAnswerText,
    explanation: explanationFor(q.questionType, q.topic, mode, q.correctAnswer),
    sourceFlag: 'SYSTEM_GENERATED',
    isScannedSource: false,
    status: 'ACTIVE',
    createdBy: 'system-generator',
    points: POINTS[difficulty],
  };
}

// ─── Generation driver ───────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const existing = await prisma.question.findMany({ select: { questionText: true, questionType: true } });
  const existingText = new Set(existing.map((q) => q.questionText.trim().toLowerCase()));
  const seen = new Set(); // key includes level so the same sentence can appear at different levels
  const pending = [];

  const add = (q, level, cefr, difficulty) => {
    if (!q) return false;
    const key = `${level}|${q.questionType}|${q.questionText}`;
    if (seen.has(key) || existingText.has(q.questionText.toLowerCase())) return false;
    seen.add(key);
    pending.push(finalize(q, level, cefr, difficulty));
    return true;
  };

  // Per-type per-level target: add only enough to reach 100,000 TOTAL per type,
  // accounting for what's already in the bank.
  const existingByType = {};
  for (const q of existing) existingByType[q.questionType] = (existingByType[q.questionType] || 0) + 1;
  const targetByType = {};
  for (const type of TARGET_TYPES) {
    const remaining = Math.max(0, TYPE_TOTAL - (existingByType[type] || 0));
    targetByType[type] = Math.ceil(remaining / CEFR_LEVELS.length);
  }
  console.log('Per-level targets (to reach 100k total per type):');
  for (const type of TARGET_TYPES) {
    console.log(`  ${type}: existing=${existingByType[type] || 0}, add ${targetByType[type]}/level`);
  }
  const summary = [];

  for (const { cefr, level } of CEFR_LEVELS) {
    const profile = LEVEL_PROFILES[cefr];
    const counts = { SENTENCE_ORDERING: 0, FILL_IN_THE_BLANK: 0, ERROR_CORRECTION: 0, SYNONYM_ANTONYM: 0, TRUE_FALSE: 0 };
    const allDone = () => TARGET_TYPES.every((t) => counts[t] >= targetByType[t]);

    // Grammar-template combos (SO, FIB, EC, TF, synonym).
    for (const difficulty of DIFFICULTIES) {
      if (allDone()) break;
      const template = profile[difficulty];
      const times = template === 'past' || template === 'pastContinuous' ? PAST_TIMES
        : template === 'perfect' ? PERFECT_TIMES
        : template === 'inversion' ? INVERSION_TIMES : TIMES;
      const topic = TOPIC_BY_TEMPLATE[template];

      const combos = [];
      for (const subject of SUBJECTS) {
        for (const action of ACTIONS) {
          for (const time of times) combos.push({ subject, action, time });
        }
      }
      const rotated = stableShuffle(combos, `${level}|${difficulty}|rotate`);

      for (const { subject, action, time } of rotated) {
        if (allDone()) break;
        const { sentence, slots } = getSlots(template, subject, action, time, times);
        const combo = { sentence, slots, topic };
        const syn = SYNONYM_ACTIONS.find((s) => s.base === action.base);

        if (counts.SENTENCE_ORDERING < targetByType.SENTENCE_ORDERING) {
          if (add(makeSO(combo), level, cefr, difficulty)) counts.SENTENCE_ORDERING++;
        }
        // FIB: blank verb, object, time, subject.
        for (const slot of slots) {
          if (counts.FILL_IN_THE_BLANK >= targetByType.FILL_IN_THE_BLANK) break;
          if (add(makeFIB(combo, slot), level, cefr, difficulty)) counts.FILL_IN_THE_BLANK++;
        }
        // EC: corrupt verb, object, time, subject.
        for (const slot of slots) {
          if (counts.ERROR_CORRECTION >= targetByType.ERROR_CORRECTION) break;
          if (add(makeEC(combo, slot), level, cefr, difficulty)) counts.ERROR_CORRECTION++;
        }
        // TF: correct + incorrect sentence.
        if (counts.TRUE_FALSE < targetByType.TRUE_FALSE) {
          if (add(makeTF(combo, true), level, cefr, difficulty)) counts.TRUE_FALSE++;
        }
        if (counts.TRUE_FALSE < targetByType.TRUE_FALSE) {
          if (add(makeTF(combo, false), level, cefr, difficulty)) counts.TRUE_FALSE++;
        }
        // SA: synonym from the action.
        if (syn && counts.SYNONYM_ANTONYM < targetByType.SYNONYM_ANTONYM) {
          if (add(makeSynonym(combo, syn), level, cefr, difficulty)) counts.SYNONYM_ANTONYM++;
        }
      }
    }

    // SA: antonyms (adjective pairs × nouns × frames, both directions).
    if (counts.SYNONYM_ANTONYM < targetByType.SYNONYM_ANTONYM) {
      outerAnt: for (const [word, opposite] of ADJECTIVES) {
        for (const noun of NOUNS) {
          for (const frame of ANTONYM_FRAMES) {
            if (counts.SYNONYM_ANTONYM >= targetByType.SYNONYM_ANTONYM) break outerAnt;
            if (add(makeAntonym(word, opposite, noun, frame), level, cefr, 'medium')) counts.SYNONYM_ANTONYM++;
            if (counts.SYNONYM_ANTONYM >= targetByType.SYNONYM_ANTONYM) break;
            if (add(makeAntonym(opposite, word, noun, frame), level, cefr, 'medium')) counts.SYNONYM_ANTONYM++;
          }
        }
      }
    }

    // TF: irregular-verb facts (top up if the sentence-based TF didn't fill it).
    if (counts.TRUE_FALSE < targetByType.TRUE_FALSE) {
      outerTf: for (const verb of IRREGULAR_VERBS) {
        for (let variant = 0; variant < 12; variant++) {
          if (counts.TRUE_FALSE >= targetByType.TRUE_FALSE) break outerTf;
          if (add(makeVerbTF(verb, variant), level, cefr, 'medium')) counts.TRUE_FALSE++;
        }
      }
    }

    summary.push({ level, cefr, counts });
    console.log(`${level}: ` + TARGET_TYPES.map((t) => `${t.slice(0, 2)}=${counts[t]}/${targetByType[t]}`).join(' '));
  }

  console.log(`\nTotal new questions ready: ${pending.length}`);
  if (dryRun) {
    console.log('Dry run — nothing written. Sample:');
    pending.slice(0, 15).forEach((q) => console.log(`- [${q.cefrLevel}/${q.difficulty}/${q.questionType}] ${q.questionText}`));
    return;
  }

  const batchSize = 1000;
  for (let start = 0; start < pending.length; start += batchSize) {
    await prisma.question.createMany({ data: pending.slice(start, start + batchSize) });
    console.log(`Inserted ${Math.min(start + batchSize, pending.length)} / ${pending.length}`);
  }
  const total = await prisma.question.count();
  console.log(`Question bank now contains ${total} questions.`);
}

main()
  .catch((error) => {
    console.error('Multi-type generation failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
