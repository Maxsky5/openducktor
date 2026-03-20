import { describe, expect, test } from "bun:test";
import { isQuestionToolName } from "./question-tools";

describe("question-tools", () => {
  test("matches canonical question tool names", () => {
    expect(isQuestionToolName("question")).toBe(true);
    expect(isQuestionToolName("ask_question")).toBe(true);
  });

  test("does not match unrelated tool names that contain question as a substring", () => {
    expect(isQuestionToolName("question_context_builder")).toBe(false);
    expect(isQuestionToolName("documentation_questions")).toBe(false);
    expect(isQuestionToolName("frequently_asked_questions_lookup")).toBe(false);
  });
});
