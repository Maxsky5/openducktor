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

const userMessage = (
  messageId: string,
  timestamp = "2026-09-19T10:01:00.000Z",
  text = "Continue",
) => ({ messageId, timestamp, text });

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
    const answered = applyAsyncQuestionUserMessage(
      pending,
      [
        {
          questionItemId: question("message-1").questionItemId,
          question: "Question 1",
          answer: "Yes",
        },
      ],
      userMessage("reply-message"),
    );

    expect(answered.pendingAsyncQuestions).toEqual([question("message-2")]);
    expect(
      applyAsyncQuestionUserMessage(answered, undefined, userMessage("ordinary-message"))
        .pendingAsyncQuestions,
    ).toEqual([]);
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
      userMessage("ordinary-message"),
    );

    expect(
      mergeAsyncQuestionHistory(projectAsyncQuestionsFromHistory(history), current, atReadStart)
        .pendingAsyncQuestions,
    ).toEqual([]);
  });

  test("history does not reopen a question handled before the read began", () => {
    const source = question("message-1");
    const history = applyAsyncQuestionAnnotation(emptyAgentAsyncQuestionProjection(), {
      status: "pending",
      questions: [source],
    });
    const handled = applyAsyncQuestionUserMessage(
      history,
      undefined,
      userMessage("ordinary-message"),
    );

    expect(mergeAsyncQuestionHistory(history, handled, handled)).toEqual(handled);
  });

  test("keeps a history question asked after a live ordinary message", () => {
    const beforeMessage = question("message-before");
    const afterMessage = question("message-after");
    const history = projectAsyncQuestionsFromHistory([
      {
        role: "assistant",
        messageId: beforeMessage.sourceMessageId,
        timestamp: "2026-09-19T10:00:00.000Z",
        text: beforeMessage.title,
        parts: [],
        asyncQuestion: { status: "pending", questions: [beforeMessage] },
      },
      {
        role: "user",
        messageId: "ordinary-message",
        timestamp: "2026-09-19T10:01:00.000Z",
        text: "Continue",
        displayParts: [{ kind: "text", text: "Continue" }],
        state: "read",
        parts: [],
      },
      {
        role: "assistant",
        messageId: afterMessage.sourceMessageId,
        timestamp: "2026-09-19T10:02:00.000Z",
        text: afterMessage.title,
        parts: [],
        asyncQuestion: { status: "pending", questions: [afterMessage] },
      },
    ]);
    const atReadStart = emptyAgentAsyncQuestionProjection();
    const current = applyAsyncQuestionUserMessage(
      atReadStart,
      undefined,
      userMessage("codex-user-synthetic"),
    );

    const merged = mergeAsyncQuestionHistory(history, current, atReadStart);
    const replayed = applyAsyncQuestionAnnotation(merged, {
      status: "pending",
      questions: [afterMessage],
    });

    expect(history.pendingAsyncQuestions).toEqual([afterMessage]);
    expect(merged.pendingAsyncQuestions).toEqual([afterMessage]);
    expect(merged.handledAsyncQuestionIds).toContain(beforeMessage.questionItemId);
    expect(merged.handledAsyncQuestionIds).not.toContain(afterMessage.questionItemId);
    expect(merged.asyncQuestionSkipMessages).toHaveLength(1);
    expect(replayed.pendingAsyncQuestions).toEqual([afterMessage]);
  });

  test("history resolves only the stable ID in a contextual reply", () => {
    const first = question("message-1", 0);
    const second = question("message-1", 1);
    const projected = projectAsyncQuestionsFromHistory([
      {
        role: "assistant",
        messageId: "message-1",
        timestamp: "2026-09-19T10:00:00.000Z",
        text: "Choose two settings",
        parts: [],
        asyncQuestion: { status: "pending", questions: [first, second] },
      },
      {
        role: "user",
        messageId: "reply-1",
        timestamp: "2026-09-19T10:01:00.000Z",
        text: "> Question 1\n\nYes",
        displayParts: [],
        state: "read",
        parts: [],
        asyncQuestionReplies: [
          { questionItemId: first.questionItemId, question: first.title, answer: "Yes" },
        ],
      },
    ]);

    expect(projected.pendingAsyncQuestions).toEqual([second]);
    expect(projected.handledAsyncQuestionIds).toEqual(new Set([first.questionItemId]));
  });
});
