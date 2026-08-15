import { describe, expect, test } from "bun:test";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { toAssistantMessageMeta } from "./assistant-meta";

const sessionFixture: AgentSessionState = {
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  status: "running",
  runtimeStatusMessage: null,
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  historyLoadState: "not_requested",
  messages: createSessionMessagesState("external-1"),
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    variant: "high",
  },
};

describe("agent-orchestrator/support/assistant-meta", () => {
  test("does not invent assistant model metadata from current session selection", () => {
    const meta = toAssistantMessageMeta(sessionFixture, 1200, 42);
    expect(meta.kind).toBe("assistant");
    expect(meta.providerId).toBeUndefined();
    expect(meta.modelId).toBeUndefined();
    expect(meta.variant).toBeUndefined();
    expect(meta.durationMs).toBe(1200);
    expect(meta.totalTokens).toBe(42);
  });

  test("uses explicit message model metadata without current-session fallback fields", () => {
    const meta = toAssistantMessageMeta(
      {
        ...sessionFixture,
        selectedModel: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "Hephaestus",
        },
      },
      1200,
      42,
      {
        providerId: "anthropic",
        modelId: "claude-3-7-sonnet",
      },
    );

    expect(meta.providerId).toBe("anthropic");
    expect(meta.modelId).toBe("claude-3-7-sonnet");
    expect(meta.profileId).toBeUndefined();
    expect(meta.variant).toBeUndefined();
  });
});
