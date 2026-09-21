import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { CodexQuestionHistory } from "./codex-question-history";

const message = (messageId: string, timestamp: string): AgentSessionHistoryMessage => ({
  messageId,
  role: "assistant",
  timestamp,
  text: "",
  parts: [],
});

describe("CodexQuestionHistory", () => {
  test("adds live question rows by time without duplicating native history", () => {
    const questions = new CodexQuestionHistory();
    questions.add("runtime-1", "thread-1", message("question-1", "2026-09-21T12:00:02.000Z"));

    expect(
      questions
        .merge("runtime-1", "thread-1", [
          message("before", "2026-09-21T12:00:01.000Z"),
          message("after", "2026-09-21T12:00:03.000Z"),
        ])
        .map(({ messageId }) => messageId),
    ).toEqual(["before", "question-1", "after"]);
    expect(
      questions
        .merge("runtime-1", "thread-1", [message("question-1", "2026-09-21T12:00:02.000Z")])
        .map(({ messageId }) => messageId),
    ).toEqual(["question-1"]);
  });
});
