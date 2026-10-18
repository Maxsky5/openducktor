import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { closeBackgroundQuestions, projectBackgroundQuestions } from "./background-questions";

const question = (requestId: string) => ({
  requestId,
  blocking: false,
  questions: [
    {
      header: "Choice",
      question: `Question ${requestId}`,
      options: [
        { label: "Yes", description: "Yes" },
        { label: "No", description: "No" },
      ],
    },
  ],
});

describe("background question projection", () => {
  test("keeps unresolved questions and drops resolved questions", () => {
    const first = question("question-1");
    const second = question("question-2");
    const history: AgentSessionHistoryMessage[] = [
      {
        role: "assistant",
        messageId: "question-1",
        timestamp: "2026-09-19T10:00:00.000Z",
        text: "Question one",
        parts: [],
        questionRequest: first,
      },
      {
        role: "assistant",
        messageId: "question-2",
        timestamp: "2026-09-19T10:00:01.000Z",
        text: "Question two",
        parts: [],
        questionRequest: second,
      },
      {
        role: "user",
        messageId: "answer-1",
        timestamp: "2026-09-19T10:00:02.000Z",
        text: "Yes",
        displayParts: [{ kind: "text", text: "Yes" }],
        state: "read",
        parts: [],
        resolvedQuestionRequestIds: [first.requestId],
      },
    ];

    expect(projectBackgroundQuestions(history)).toEqual([second]);
  });

  test("treats a user message without a marker as handling earlier questions", () => {
    const pending = question("question-1");
    const history: AgentSessionHistoryMessage[] = [
      {
        role: "assistant",
        messageId: pending.requestId,
        timestamp: "2026-09-19T10:00:00.000Z",
        text: "Question one",
        parts: [],
        questionRequest: pending,
      },
      {
        role: "user",
        messageId: "answer-1",
        timestamp: "2026-09-19T10:00:01.000Z",
        text: "Continue",
        displayParts: [{ kind: "text", text: "Continue" }],
        state: "read",
        parts: [],
      },
    ];

    expect(projectBackgroundQuestions(history)).toEqual([]);
  });

  test("closes answered questions and keeps blocking questions", () => {
    const background = question("question-1");
    const blocking = { ...question("question-2"), blocking: true };

    expect(
      closeBackgroundQuestions({ pendingQuestions: [background, blocking] }, [
        background.requestId,
      ]),
    ).toEqual({
      pendingQuestions: [blocking],
    });
  });
});
