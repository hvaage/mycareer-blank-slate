type SurveyQuestion = {
  id: string;
  is_required?: boolean;
  question_type: "single_choice" | "multi_choice" | "ranked_choice" | "scale" | "open_text";
};

export function hasOtherSelection(value: unknown) {
  return Array.isArray(value) ? value.includes("Annet") : value === "Annet";
}

export function isSurveyQuestionAnswered(
  question: SurveyQuestion,
  value: unknown,
  textValue: string,
) {
  if (!question.is_required) return true;

  if (question.question_type === "open_text") {
    return textValue.trim().length > 0;
  }

  if (question.question_type === "multi_choice" || question.question_type === "ranked_choice") {
    if (!Array.isArray(value) || value.length === 0) return false;
  } else if (value === undefined || value === null || value === "") {
    return false;
  }

  return !hasOtherSelection(value) || textValue.trim().length > 0;
}

export function surveyAnswerPayload(question: SurveyQuestion, value: unknown, textValue: string) {
  const text = textValue.trim();
  if (question.question_type === "open_text") {
    return text ? { question_id: question.id, answer_value: text, text_answer: text } : null;
  }

  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return null;
  }

  return {
    question_id: question.id,
    answer_value: value,
    text_answer: hasOtherSelection(value) && text ? text : null,
  };
}
