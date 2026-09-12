import { describe, expect, it } from "vitest";
import {
  hasOtherSelection,
  isSurveyQuestionAnswered,
  surveyAnswerPayload,
} from "../recruiter-survey-form";

const requiredSingle = {
  id: "single",
  is_required: true,
  question_type: "single_choice" as const,
};

const requiredMulti = {
  id: "multi",
  is_required: true,
  question_type: "multi_choice" as const,
};

describe("recruiter survey form", () => {
  it("recognizes Annet in single and multiple choice answers", () => {
    expect(hasOtherSelection("Annet")).toBe(true);
    expect(hasOtherSelection(["AI-kompetanse", "Annet"])).toBe(true);
    expect(hasOtherSelection(["AI-kompetanse"])).toBe(false);
  });

  it("requires an explanation when Annet is selected", () => {
    expect(isSurveyQuestionAnswered(requiredSingle, "Annet", "")).toBe(false);
    expect(isSurveyQuestionAnswered(requiredMulti, ["Annet"], "  ")).toBe(false);
    expect(isSurveyQuestionAnswered(requiredMulti, ["Annet"], "Eget svar")).toBe(true);
  });

  it("does not require an explanation for predefined options", () => {
    expect(isSurveyQuestionAnswered(requiredSingle, "Lønn", "")).toBe(true);
    expect(isSurveyQuestionAnswered(requiredMulti, ["AI-kompetanse"], "")).toBe(true);
  });

  it("stores the Annet explanation alongside the selected answer", () => {
    expect(surveyAnswerPayload(requiredMulti, ["AI-kompetanse", "Annet"], " Ny ferdighet ")).toEqual({
      question_id: "multi",
      answer_value: ["AI-kompetanse", "Annet"],
      text_answer: "Ny ferdighet",
    });
  });
});