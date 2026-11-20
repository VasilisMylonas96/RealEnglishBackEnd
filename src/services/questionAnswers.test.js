const test = require('node:test');
const assert = require('node:assert/strict');
const { isQuestionAnswerCorrect } = require('./questionAnswers');
const { getTypeQuotas } = require('./balancedQuizQuestions');
const { convertQuestion } = require('./questionBankDiversifier');

test('legacy multiple-choice answers continue to use their option index', () => {
  assert.equal(isQuestionAnswerCorrect({ questionType: 'MULTIPLE_CHOICE', correctAnswer: 2 }, 2), true);
  assert.equal(isQuestionAnswerCorrect({ questionType: 'MULTIPLE_CHOICE', correctAnswer: 2 }, 1), false);
});

test('sentence ordering requires every token in the correct sequence', () => {
  const question = {
    questionType: 'SENTENCE_ORDERING',
    correctAnswerText: '["I","have","never","seen","that"]',
  };
  assert.equal(isQuestionAnswerCorrect(question, ['I', 'have', 'never', 'seen', 'that']), true);
  assert.equal(isQuestionAnswerCorrect(question, ['I', 'never', 'have', 'seen', 'that']), false);
  assert.equal(isQuestionAnswerCorrect(question, ['I', 'have']), false);
});

test('default type percentages cover all questions without rounding loss', () => {
  const quotas = getTypeQuotas(10, {
    MULTIPLE_CHOICE: 35,
    SENTENCE_ORDERING: 20,
    FILL_IN_THE_BLANK: 20,
    ERROR_CORRECTION: 10,
    SYNONYM_ANTONYM: 10,
    TRUE_FALSE: 5,
  });
  assert.equal(Object.values(quotas).reduce((sum, quota) => sum + quota, 0), 10);
  assert.deepEqual(quotas, {
    MULTIPLE_CHOICE: 4,
    SENTENCE_ORDERING: 2,
    FILL_IN_THE_BLANK: 2,
    ERROR_CORRECTION: 1,
    SYNONYM_ANTONYM: 1,
    TRUE_FALSE: 0,
  });
});

test('generated question variants retain valid answer payloads', () => {
  const source = {
    id: 'generated-test-question',
    questionText: 'Every morning, my brother ___ the daily schedule.',
    options: JSON.stringify(['checks', 'check', 'checked', 'is checking']),
    correctAnswer: 0,
  };
  const ordering = convertQuestion(source, 'SENTENCE_ORDERING');
  const orderingAnswer = JSON.parse(ordering.correctAnswerText);
  assert.equal(ordering.questionType, 'SENTENCE_ORDERING');
  assert.deepEqual([...JSON.parse(ordering.options)].sort(), [...orderingAnswer].sort());

  const fillIn = convertQuestion(source, 'FILL_IN_THE_BLANK');
  assert.equal(fillIn.questionData, JSON.stringify({ sentenceParts: [source.questionText] }));
  assert.equal(JSON.parse(fillIn.options)[fillIn.correctAnswer], fillIn.correctAnswerText);

  const synonym = convertQuestion(source, 'SYNONYM_ANTONYM');
  assert.equal(JSON.parse(synonym.options)[synonym.correctAnswer], synonym.correctAnswerText);

  const errorCorrection = convertQuestion(source, 'ERROR_CORRECTION');
  assert.equal(errorCorrection.questionData, JSON.stringify({ correction: 'checks' }));
  assert.ok(errorCorrection.correctAnswer >= 0);

  const trueFalse = convertQuestion(source, 'TRUE_FALSE');
  assert.deepEqual(JSON.parse(trueFalse.options), ['True', 'False']);
  assert.ok(trueFalse.correctAnswer === 0 || trueFalse.correctAnswer === 1);
});
