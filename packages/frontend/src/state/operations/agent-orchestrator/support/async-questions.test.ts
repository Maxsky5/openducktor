import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  applyAsyncQuestionAnnotation,
  applyAsyncQuestionUserMessage,
  emptyAgentAsyncQuestionProjection,
  mergeAsyncQuestionHistory,
  projectAsyncQuestionsFromHistory,
} from "./async-questions";

const question = (sourceMessageId: string, questionIndex = 0) => ({
  questionItemId: JSON.stringify(["request_user_input_async", sourceMessageId, questionIndex]),
  sourceMessageId,
  questionIndex,
  title: `Question ${questionIndex + 1}`,
  options: ["Yes", "No"],
});

describe("asynchronous question projection", () => {
  test("keeps several questions pending without blocking turn state", () => {
    const projected = applyAsyncQuestionAnnotation(emptyAgentAsyncQuestionProjection(), {
      status: "pending",
      questions: [question("message-1", 0), question("message-1", 1)],
    });

    expect(projected.pendingAsyncQuestions).toHaveLength(2);
    expect(projected.handledAsyncQuestionIds.size).toBe(0);
  });

  test("resolves the answered ID and treats an ordinary user message as skip", () => {
    const pending = applyAsyncQuestionAnnotation(emptyAgentAsyncQuestionProjection(), {
      status: "pending",
      questions: [question("message-1"), question("message-2")],
    });
    const answered = applyAsyncQuestionUserMessage(pending, [
      {
        questionItemId: question("message-1").questionItemId,
        question: "Question 1",
        answer: "Yes",
      },
    ]);

    expect(answered.pendingAsyncQuestions).toEqual([question("message-2")]);
    expect(applyAsyncQuestionUserMessage(answered, undefined).pendingAsyncQuestions).toEqual([]);
  });

  test("history does not reopen a question handled after the read began", () => {
    const source = question("message-1");
    const history: AgentSessionHistoryMessage[] = [
      {
        role: "assistant",
        messageId: "message-1",
        timestamp: "2026-09-19T10:00:00.000Z",
        text: source.title,
        parts: [],
        asyncQuestion: { status: "pending", questions: [source] },
      },
    ];
    const atReadStart = emptyAgentAsyncQuestionProjection();
    const current = applyAsyncQuestionUserMessage(
      applyAsyncQuestionAnnotation(atReadStart, { status: "pending", questions: [source] }),
      undefined,
    );

    expect(
      mergeAsyncQuestionHistory(projectAsyncQuestionsFromHistory(history), current, atReadStart)
        .pendingAsyncQuestions,
    ).toEqual([]);
  });
});
