import { describe, expect, test } from "bun:test";
import { agentAsyncQuestionSchema } from "./agent-async-question-schemas";

describe("agentAsyncQuestionSchema", () => {
  test("preserves non-blank source text", () => {
    expect(
      agentAsyncQuestionSchema.parse({
        questionItemId: "question-1",
        sourceMessageId: "message-1",
        questionIndex: 0,
        title: "  Keep title spacing  ",
        options: [" First ", "Second"],
      }),
    ).toEqual({
      questionItemId: "question-1",
      sourceMessageId: "message-1",
      questionIndex: 0,
      title: "  Keep title spacing  ",
      options: [" First ", "Second"],
    });
  });

  test("rejects blank text and empty option lists", () => {
    const source = {
      questionItemId: "question-1",
      sourceMessageId: "message-1",
      questionIndex: 0,
      title: "Choose",
      options: ["First"],
    };

    expect(agentAsyncQuestionSchema.safeParse({ ...source, title: "   " }).success).toBe(false);
    expect(agentAsyncQuestionSchema.safeParse({ ...source, options: [] }).success).toBe(false);
    expect(agentAsyncQuestionSchema.safeParse({ ...source, options: ["   "] }).success).toBe(false);
  });
});
