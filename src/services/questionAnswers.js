function parseQuestionData(question, revealAnswers = false) {
  if (!question.questionData) return null;
  const data = JSON.parse(question.questionData);
  if (revealAnswers) return data;
  const safeData = { ...data };
  delete safeData.correction;
  delete safeData.correctAnswer;
  delete safeData.correctOrder;
  return safeData;
}

function isQuestionAnswerCorrect(question, selectedAnswer) {
  if (question.questionType === 'SENTENCE_ORDERING') {
    if (!Array.isArray(selectedAnswer)) return false;
    let expected;
    try {
      expected = JSON.parse(question.correctAnswerText || 'null');
    } catch (err) {
      return false;
    }
    return Array.isArray(expected)
      && selectedAnswer.length === expected.length
      && selectedAnswer.every((token, index) => token === expected[index]);
  }
  return selectedAnswer === question.correctAnswer;
}

module.exports = { parseQuestionData, isQuestionAnswerCorrect };
