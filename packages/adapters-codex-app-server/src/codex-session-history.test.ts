import { describe, expect, test } from "bun:test";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { LoadAgentSessionHistoryInput } from "@openducktor/core";
import { finalizeCodexSessionHistory } from "./codex-session-history";
import { defaultCodexEffectivePolicy } from "./codex-app-server-adapter.test-harness";

const inputWithLimit = (limit: number | undefined): LoadAgentSessionHistoryInput => {
  const input: LoadAgentSessionHistoryInput = {
    repoPath: "/repo",
    workingDirectory: "/repo",
    externalSessionId: "thread-1",
    runtimeKind: "codex",
    runtimePolicy: { kind: "codex", policy: defaultCodexEffectivePolicy() },
  };
  return limit === undefined ? input : { ...input, limit };
};

const historyMessage = (messageId: string, role: AgentSessionHistoryMessage["role"]) => ({
  messageId,
  role,
  timestamp: "2026-05-07T00:00:00.000Z",
  text: `text for ${messageId}`,
  parts: [],
});

const conversationHistory = (count: number): AgentSessionHistoryMessage[] =>
  Array.from({ length: count }, (_value, index) =>
    historyMessage(`turn-${index}`, index % 2 === 0 ? "user" : "assistant"),
  );

describe("finalizeCodexSessionHistory", () => {
  test("keeps the newest messages when the limit cuts the history", () => {
    const history = conversationHistory(10);

    const limited = finalizeCodexSessionHistory(inputWithLimit(4), history);

    expect(limited.map((message) => message.messageId)).toEqual([
      "turn-6",
      "turn-7",
      "turn-8",
      "turn-9",
    ]);
  });

  test("keeps the full history when the limit covers it", () => {
    const history = conversationHistory(3);

    expect(finalizeCodexSessionHistory(inputWithLimit(3), history)).toEqual(history);
    expect(finalizeCodexSessionHistory(inputWithLimit(10), history)).toEqual(history);
  });

  test("keeps the full history when the input has no limit", () => {
    const history = conversationHistory(3);

    expect(finalizeCodexSessionHistory(inputWithLimit(undefined), history)).toEqual(history);
  });

  test("keeps session context rows that the limit drops from the head", () => {
    const history: AgentSessionHistoryMessage[] = [
      historyMessage("codex-system-prompt:thread-1", "system"),
      historyMessage("codex-fork-boundary:thread-1", "system"),
      ...conversationHistory(6),
    ];

    const limited = finalizeCodexSessionHistory(inputWithLimit(3), history);

    expect(limited.map((message) => message.messageId)).toEqual([
      "codex-system-prompt:thread-1",
      "codex-fork-boundary:thread-1",
      "turn-3",
      "turn-4",
      "turn-5",
    ]);
  });

  test("keeps a context row once when the limit cuts the head", () => {
    const history: AgentSessionHistoryMessage[] = [
      historyMessage("codex-system-prompt:thread-1", "system"),
      ...conversationHistory(3),
    ];

    const limited = finalizeCodexSessionHistory(inputWithLimit(3), history);

    expect(limited.map((message) => message.messageId)).toEqual([
      "codex-system-prompt:thread-1",
      "turn-0",
      "turn-1",
      "turn-2",
    ]);
  });
});
