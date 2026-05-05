import { describe, expect, test } from "bun:test";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { resolveActiveSessionChatComposerContext } from "./active-session-chat-composer-context";

const makeSummary = (): AgentSessionSummary => ({
  externalSessionId: "external-1",
  repoPath: "/repo",
  taskId: "task-1",
  role: "spec",
  status: "idle",
  startedAt: "2026-02-20T10:00:00.000Z",
  workingDirectory: "/repo",
  runtimeKind: "opencode",
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "anthropic",
    modelId: "claude-sonnet",
    profileId: "build-agent",
  },
  pendingApprovals: [],
  pendingQuestions: [],
});

const makeHydratedSession = (): AgentSessionState =>
  ({
    externalSessionId: "external-1",
    repoPath: "/repo",
    status: "idle",
    selectedModel: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      profileId: "spec-agent",
    },
    modelCatalog: null,
    runtimeKind: "opencode",
    workingDirectory: "/repo/session-worktree",
    isLoadingModelCatalog: false,
    contextUsage: null,
    messages: [],
  }) as unknown as AgentSessionState;

describe("active-session-chat-composer-context", () => {
  test("prefers hydrated session runtime fields while preserving summary selection fallback", () => {
    const hydratedSession = makeHydratedSession();
    const state = resolveActiveSessionChatComposerContext(hydratedSession, makeSummary());

    expect(state.externalSessionId).toBe("external-1");
    expect(state.selectedModel).toEqual(hydratedSession.selectedModel);
    expect(state.runtimeKind).toBe("opencode");
    expect(state.workingDirectory).toBe("/repo/session-worktree");
    expect(state.isLoadingModelCatalog).toBe(false);
    expect(state.hasActiveSession).toBe(true);
  });

  test("keeps summary selection available while the hydrated session is missing", () => {
    const summary = makeSummary();
    const state = resolveActiveSessionChatComposerContext(null, summary);

    expect(state.externalSessionId).toBe("external-1");
    expect(state.selectedModel).toEqual(summary.selectedModel);
    expect(state.runtimeKind).toBe("opencode");
    expect(state.workingDirectory).toBe("/repo");
    expect(state.isLoadingModelCatalog).toBe(true);
    expect(state.hasActiveSession).toBe(true);
  });
});
