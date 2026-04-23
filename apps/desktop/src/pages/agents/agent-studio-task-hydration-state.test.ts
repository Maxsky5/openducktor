import { describe, expect, test } from "bun:test";
import { deriveAgentStudioTaskHydrationState } from "./agent-studio-task-hydration-state";

describe("deriveAgentStudioTaskHydrationState", () => {
  test("blocks a missing-history session while repo readiness is unavailable", () => {
    const lifecycle = deriveAgentStudioTaskHydrationState({
      activeSession: {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/repo-a",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/repo-a",
        messages: [],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: null,
        isLoadingModelCatalog: false,
        runtimeRecoveryState: "idle",
        historyHydrationState: "failed",
      },
      agentStudioReadinessState: "checking",
    });

    expect(lifecycle.phase).toBe("blocked_on_repo");
    expect(lifecycle.isWaitingForRuntimeReadiness).toBe(true);
  });

  test("waits for a build session runtime attachment even after page readiness turns ready", () => {
    const lifecycle = deriveAgentStudioTaskHydrationState({
      activeSession: {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/repo-a",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: null,
        workingDirectory: "/repo-a/worktree",
        messages: [],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: null,
        isLoadingModelCatalog: false,
        runtimeRecoveryState: "idle",
        historyHydrationState: "not_requested",
      },
      agentStudioReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("waiting_for_runtime_attachment");
    expect(lifecycle.shouldWaitForRuntimeAttachment).toBe(true);
    expect(lifecycle.shouldEnsureReadyForView).toBe(true);
  });

  test("shows a recovering waiting session while runtime reattachment is in progress", () => {
    const lifecycle = deriveAgentStudioTaskHydrationState({
      activeSession: {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/repo-a",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/repo-a",
        messages: [],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: null,
        isLoadingModelCatalog: false,
        runtimeRecoveryState: "recovering_runtime",
        historyHydrationState: "not_requested",
      },
      agentStudioReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("recovering_runtime");
    expect(lifecycle.isWaitingForRuntimeReadiness).toBe(true);
  });

  test("treats attached stdio build sessions as ready for history hydration", () => {
    const lifecycle = deriveAgentStudioTaskHydrationState({
      activeSession: {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/repo-a",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "stdio" },
        workingDirectory: "/repo-a/worktree",
        messages: [],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: null,
        isLoadingModelCatalog: false,
        runtimeRecoveryState: "idle",
        historyHydrationState: "not_requested",
      },
      agentStudioReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("needs_history");
    expect(lifecycle.shouldEnsureReadyForView).toBe(true);
  });

  test("keeps existing transcript renderable even if a previous history hydration failed", () => {
    const lifecycle = deriveAgentStudioTaskHydrationState({
      activeSession: {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/repo-a",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: null,
        workingDirectory: "/repo-a/worktree",
        messages: [
          {
            id: "local-message-1",
            role: "assistant",
            content: "Still viewable",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: null,
        isLoadingModelCatalog: false,
        runtimeRecoveryState: "idle",
        historyHydrationState: "failed",
      },
      agentStudioReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("waiting_for_runtime_attachment");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.isHistoryHydrationFailed).toBe(false);
    expect(lifecycle.shouldWaitForRuntimeAttachment).toBe(true);
  });

  test("requests background hydration once an attached session still has transcript after a prior history failure", () => {
    const lifecycle = deriveAgentStudioTaskHydrationState({
      activeSession: {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/repo-a",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/repo-a",
        messages: [
          {
            id: "local-message-1",
            role: "assistant",
            content: "Still viewable",
            timestamp: "2026-02-22T08:00:03.000Z",
          },
        ],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: null,
        isLoadingModelCatalog: false,
        runtimeRecoveryState: "idle",
        historyHydrationState: "failed",
      },
      agentStudioReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("needs_history");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.isHistoryHydrationFailed).toBe(false);
    expect(lifecycle.shouldEnsureReadyForView).toBe(true);
    expect(lifecycle.shouldWaitForRuntimeAttachment).toBe(false);
  });

  test("renders empty history when hydration already completed successfully", () => {
    const lifecycle = deriveAgentStudioTaskHydrationState({
      activeSession: {
        sessionId: "session-1",
        externalSessionId: "external-1",
        taskId: "task-1",
        repoPath: "/repo-a",
        role: "planner",
        scenario: "planner_initial",
        status: "idle",
        startedAt: "2026-02-22T08:00:00.000Z",
        runtimeKind: "opencode",
        runtimeId: null,
        runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
        workingDirectory: "/repo-a",
        messages: [],
        draftAssistantText: "",
        draftAssistantMessageId: null,
        draftReasoningText: "",
        draftReasoningMessageId: null,
        contextUsage: null,
        pendingPermissions: [],
        pendingQuestions: [],
        todos: [],
        modelCatalog: null,
        selectedModel: null,
        isLoadingModelCatalog: false,
        runtimeRecoveryState: "idle",
        historyHydrationState: "hydrated",
      },
      agentStudioReadinessState: "ready",
    });

    expect(lifecycle.phase).toBe("ready");
    expect(lifecycle.canRenderHistory).toBe(true);
    expect(lifecycle.isHydratingHistory).toBe(false);
  });
});
