import { describe, expect, test } from "bun:test";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { sessionMessageAt } from "@/test-utils/session-message-test-helpers";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { finalizeDraftAssistantMessage, toAssistantMessageMeta } from "./assistant-meta";

const sessionFixture: AgentSessionState = {
  runtimeKind: "opencode",
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: "/tmp/repo",
  role: "build",
  scenario: "build_implementation_start",
  status: "running",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: null,
  runId: "run-1",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "Draft answer",
  draftAssistantMessageId: "assistant-msg-1",
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: {
    models: [
      {
        id: "openai/gpt-5",
        providerId: "openai",
        providerName: "OpenAI",
        modelId: "gpt-5",
        modelName: "GPT-5",
        variants: ["high"],
        contextWindow: 200000,
        outputLimit: 8000,
      },
    ],
    defaultModelsByProvider: { openai: "gpt-5" },
    profiles: [],
  },
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    variant: "high",
  },
  isLoadingModelCatalog: false,
};

describe("agent-orchestrator/support/assistant-meta", () => {
  test("builds assistant meta from session context", () => {
    const meta = toAssistantMessageMeta(sessionFixture, 1200, 42);
    expect(meta.kind).toBe("assistant");
    expect(meta.providerId).toBe("openai");
    expect(meta.durationMs).toBe(1200);
    expect(meta.totalTokens).toBe(42);
  });

  test("merges partial message metadata over session selection", () => {
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
    expect(meta.profileId).toBe("Hephaestus");
    expect(meta.variant).toBe("high");
  });

  test("finalizes draft assistant text into a message", () => {
    const finalized = finalizeDraftAssistantMessage(
      sessionFixture,
      "2026-02-22T08:00:01.000Z",
      900,
      24,
    );

    expect(finalized.draftAssistantText).toBe("");
    expect(getSessionMessageCount(finalized)).toBe(1);
    expect(sessionMessageAt(finalized, 0)?.role).toBe("assistant");
    expect(sessionMessageAt(finalized, 0)?.content).toBe("Draft answer");
    expect(sessionMessageAt(finalized, 0)?.timestamp).toBe("2026-02-22T08:00:01.000Z");
  });
});
