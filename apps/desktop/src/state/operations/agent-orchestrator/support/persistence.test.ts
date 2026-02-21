import { describe, expect, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionRecord } from "@openducktor/contracts";
import {
  fromPersistedSessionRecord,
  historyToChatMessages,
  toPersistedSessionRecord,
} from "./persistence";

const recordFixture: AgentSessionRecord = {
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  updatedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: "runtime-1",
  runId: "run-1",
  baseUrl: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo/worktree",
  selectedModel: {
    providerId: "openai",
    modelId: "gpt-5",
  },
};

describe("agent-orchestrator/support/persistence", () => {
  test("normalizes persisted running status to stopped", () => {
    const hydrated = fromPersistedSessionRecord(recordFixture);
    expect(hydrated.status).toBe("stopped");
    expect(hydrated.selectedModel?.modelId).toBe("gpt-5");
  });

  test("persists session with endedAt for terminal states", () => {
    const session: AgentSessionState = {
      ...fromPersistedSessionRecord(recordFixture),
      status: "error",
    };
    const persisted = toPersistedSessionRecord(session, "2026-02-22T08:10:00.000Z");
    expect(persisted.endedAt).toBe("2026-02-22T08:10:00.000Z");
  });

  test("maps empty history to empty chat messages", () => {
    const messages = historyToChatMessages([], {
      role: "build",
      selectedModel: null,
    });
    expect(messages).toEqual([]);
  });

  test("maps history parts into chat timeline entries", () => {
    const messages = historyToChatMessages(
      [
        {
          messageId: "m-user",
          role: "user",
          timestamp: "2026-02-22T08:00:00.000Z",
          text: "Please implement this",
          parts: [
            {
              kind: "text",
              messageId: "m-user",
              partId: "p-user",
              text: "Please implement this",
              synthetic: false,
              completed: true,
            },
          ],
        },
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "Done",
          totalTokens: 123,
          parts: [
            {
              kind: "reasoning",
              messageId: "m-assistant",
              partId: "p-thinking",
              text: "Thinking",
              completed: true,
            },
            {
              kind: "tool",
              messageId: "m-assistant",
              partId: "p-tool",
              callId: "call-1",
              tool: "todowrite",
              status: "completed",
              input: { key: "value" },
              output: '{"ok":true}',
              startedAtMs: 100,
              endedAtMs: 200,
            },
            {
              kind: "subtask",
              messageId: "m-assistant",
              partId: "p-subtask",
              agent: "build",
              prompt: "Implement",
              description: "Did work",
            },
          ],
        },
      ],
      {
        role: "build",
        selectedModel: {
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
        },
      },
    );

    expect(messages.some((entry) => entry.role === "thinking")).toBe(true);
    expect(messages.some((entry) => entry.role === "tool")).toBe(true);
    expect(
      messages.some(
        (entry) => entry.role === "system" && entry.content.includes("Subtask (build)"),
      ),
    ).toBe(true);

    const assistant = messages.find(
      (entry) => entry.role === "assistant" && entry.content === "Done",
    );
    if (!assistant || assistant.meta?.kind !== "assistant") {
      throw new Error("Expected assistant message with assistant meta");
    }
    expect(assistant.meta.agentRole).toBe("build");
    expect(assistant.meta.totalTokens).toBe(123);
  });
});
