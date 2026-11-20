/**
 * Backfill explanations for all generated questions that lack them.
 * Uses template-based grammar-rule text per topic + question type.
 * Idempotent: only touches rows where explanation IS NULL.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TOPIC_RULES = {
  'Present Simple': 'Use the present simple for regular habits and facts; third-person singular subjects take the -s form.',
  'Present Continuous': 'Use the present continuous for actions happening now or around the present.',
  'Present Simple vs Continuous': 'A regular habit takes the present simple; an action happening now takes the present continuous.',
  'Past Simple': 'Use the past simple for a completed action at a definite time in the past.',
  'Past Continuous': 'Use the past continuous for an action in progress at a particular past time.',
  'Past Simple vs Continuous': 'A completed past action takes the past simple; an action in progress takes the past continuous.',
  'Present Perfect': 'Use the present perfect for an experience or action connected to the present.',
  'Present Perfect vs Past Simple': 'A finished past time takes the past simple; an unfinished period or present connection takes the present perfect.',
  'Modals': 'Choose the modal that matches the degree of necessity or possibility in the context.',
  'Conditionals': 'Match the conditional structure: past form in the if-clause, would + base verb in the result.',
  'Second Conditional': 'The second conditional uses a past form in the if-clause and would + base verb in the result.',
  'Third Conditional': 'The third conditional uses had + past participle in the if-clause and would have + past participle in the result.',
  'Passive Voice': 'Use the passive when the receiver of the action is more important than the person doing it.',
  'Inversion': 'Negative or restrictive adverbials at the start of a sentence require auxiliary-subject inversion.',
  'Cleft Sentences': 'Cleft sentences use "It was ... who/that" to emphasize a part of the sentence.',
  'Subjunctive': 'Mandative subjunctive clauses use the base form of the verb after verbs such as recommend, insist, and require.',
  'Irregular Verbs': 'Irregular verbs do not take -ed in the past; memorize their unique past forms.',
  'Vocabulary': 'Choose the word that best matches the meaning in context.',
  'General': 'Apply the grammar and vocabulary rules covered in this topic.',
};

const TOPICS = Object.keys(TOPIC_RULES);

async function main() {
  let updated = 0;

  // Grammar-based types: explanation = the grammar rule of the topic.
  for (const topic of TOPICS) {
    for (const type of ['FILL_IN_THE_BLANK', 'ERROR_CORRECTION', 'SENTENCE_ORDERING']) {
      const rule = TOPIC_RULES[topic];
      const explanation = type === 'SENTENCE_ORDERING'
        ? `Arrange the words to form a correct sentence. ${rule}`
        : type === 'ERROR_CORRECTION'
          ? `The marked word breaks the rule: ${rule.toLowerCase()}`
          : rule;
      const result = await prisma.question.updateMany({
        where: { questionType: type, topicSyllabusTag: topic, explanation: null },
        data: { explanation },
      });
      updated += result.count;
    }
  }

  // SYNONYM_ANTONYM: depends on mode (stored in questionData JSON).
  for (const mode of ['SYNONYM', 'ANTONYM']) {
    const explanation = mode === 'SYNONYM'
      ? 'The correct option is the closest synonym of the target word in this context.'
      : 'The correct option is the opposite (antonym) of the target word in this context.';
    const result = await prisma.question.updateMany({
      where: { questionType: 'SYNONYM_ANTONYM', explanation: null, questionData: { contains: `"mode":"${mode}"` } },
      data: { explanation },
    });
    updated += result.count;
  }

  // TRUE_FALSE: two families.
  // a) "Is this sentence grammatically correct?" — correctAnswer 0 = True, 1 = False.
  const tfTrue = await prisma.question.updateMany({
    where: { questionType: 'TRUE_FALSE', explanation: null, correctAnswer: 0, questionText: { startsWith: 'Is this sentence grammatically correct?' } },
    data: { explanation: 'The sentence is grammatically correct.' },
  });
  const tfFalse = await prisma.question.updateMany({
    where: { questionType: 'TRUE_FALSE', explanation: null, correctAnswer: 1, questionText: { startsWith: 'Is this sentence grammatically correct?' } },
    data: { explanation: 'The sentence contains a grammar error — check the verb form.' },
  });
  // b) "True or False: ..." verb-fact statements.
  const tfFactTrue = await prisma.question.updateMany({
    where: { questionType: 'TRUE_FALSE', explanation: null, correctAnswer: 0, questionText: { startsWith: 'True or False:' } },
    data: { explanation: 'The statement is true — the verb forms shown are correct.' },
  });
  const tfFactFalse = await prisma.question.updateMany({
    where: { questionType: 'TRUE_FALSE', explanation: null, correctAnswer: 1, questionText: { startsWith: 'True or False:' } },
    data: { explanation: 'The statement is false — review the actual past forms of the verb.' },
  });
  updated += tfTrue.count + tfFalse.count + tfFactTrue.count + tfFactFalse.count;

  const remaining = await prisma.question.count({ where: { explanation: null } });
  console.log(`Updated ${updated} questions with explanations. Remaining without: ${remaining}`);
}

main()
  .catch((e) => { console.error('Backfill failed:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
