import { describe, expect, test } from "bun:test";
import type { AgentStreamPart } from "@openducktor/core";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  readAssistantActivityStartedAtMsFromMessages,
  readAssistantActivityStartedAtMsFromParts,
  resolveAssistantTurnDurationMs,
} from "./assistant-turn-duration";

describe("assistant-turn-duration", () => {
  test("prefers explicit assistant activity over a user anchor", () => {
    expect(
      resolveAssistantTurnDurationMs({
        activityStartedAtMs: 1_500,
        userAnchorAtMs: 1_000,
        previousAssistantCompletedAtMs: 500,
        completedAtMs: 2_000,
      }),
    ).toBe(500);
  });

  test("rejects user anchors from a previous completed turn", () => {
    expect(
      resolveAssistantTurnDurationMs({
        userAnchorAtMs: 1_000,
        previousAssistantCompletedAtMs: 1_500,
        completedAtMs: 2_000,
      }),
    ).toBeUndefined();
  });

  test("reads assistant-owned activity from tool and subagent parts", () => {
    const parts = [
      {
        kind: "tool",
        messageId: "assistant-1",
        partId: "tool-1",
        callId: "call-1",
        tool: "bash",
        status: "completed",
        startedAtMs: 2_000,
      },
      {
        kind: "subagent",
        messageId: "assistant-1",
        partId: "subagent-1",
        correlationKey: "spawn:assistant-1:build:review",
        status: "completed",
        startedAtMs: 1_500,
      },
    ] satisfies AgentStreamPart[];

    expect(readAssistantActivityStartedAtMsFromParts(parts)).toBe(1_500);
  });

  test("reads the earliest assistant-owned message activity within the current turn", () => {
    const messages = [
      {
        id: "assistant-old",
        role: "assistant",
        content: "Old completion",
        timestamp: "2026-02-22T08:00:00.000Z",
        meta: { kind: "assistant", agentRole: "build", isFinal: true },
      },
      {
        id: "tool-current",
        role: "tool",
        content: "bash",
        timestamp: "2026-02-22T08:00:18.000Z",
        meta: {
          kind: "tool",
          partId: "tool-1",
          callId: "call-1",
          tool: "bash",
          status: "completed",
          startedAtMs: Date.parse("2026-02-22T08:00:12.000Z"),
        },
      },
      {
        id: "assistant-current",
        role: "assistant",
        content: "Current completion",
        timestamp: "2026-02-22T08:00:30.000Z",
        meta: { kind: "assistant", agentRole: "build", isFinal: true },
      },
    ] satisfies AgentChatMessage[];

    expect(
      readAssistantActivityStartedAtMsFromMessages({
        messages,
        previousAssistantCompletedAtMs: Date.parse("2026-02-22T08:00:10.000Z"),
        completedAtMs: Date.parse("2026-02-22T08:00:30.000Z"),
      }),
    ).toBe(Date.parse("2026-02-22T08:00:12.000Z"));
  });
});
