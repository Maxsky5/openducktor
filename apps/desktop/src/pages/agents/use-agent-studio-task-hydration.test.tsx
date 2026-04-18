import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioTaskHydration } from "./use-agent-studio-task-hydration";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioTaskHydration>[0];

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: repoPath.replace(/^\//, "").replaceAll("/", "-"),
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioTaskHydration, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  activeWorkspace: createActiveWorkspace("/repo-a"),
  activeTaskId: "task-1",
  activeSession: null,
  agentStudioReadinessState: "ready",
  hydrateRequestedTaskSessionHistory: async () => {},
  retrySessionRuntimeAttachment: async () => false,
  refreshRuntimeAttachmentSources: async () => {},
  runtimeAttachmentCandidates: [],
  ...overrides,
});

const createSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "planner",
  scenario: "planner_initial",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  runId: null,
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
  workingDirectory: "/tmp/repo",
  historyHydrationState: "not_requested",
  runtimeRecoveryState: "idle",
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
  ...overrides,
});

describe("useAgentStudioTaskHydration", () => {
  test("treats the selected task as hydrated once repo and task are known", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      expect(harness.getLatest().isActiveTaskHydrated).toBe(true);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("hydrates message history only for the active session", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession(),
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(true);
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "hydrated" }),
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
      });

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "hydrated" }),
          hydrateRequestedTaskSessionHistory,
        }),
      );
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ sessionId: "session-2", externalSessionId: "external-2" }),
          hydrateRequestedTaskSessionHistory,
        }),
      );
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 2);
    } finally {
      await harness.unmount();
    }
  });

  test("marks session history hydration as failed when the query rejects", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async () => {
      throw new Error("history failed");
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession(),
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isActiveSessionHistoryHydrationFailed);

      expect(harness.getLatest().isActiveTaskHydrated).toBe(true);
      expect(harness.getLatest().isActiveTaskHydrationFailed).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("waits for readiness before hydrating and retries the same waiting session once ready", async () => {
    const hydrationRequest = createDeferred<void>();
    const hydrateRequestedTaskSessionHistory = mock(() => hydrationRequest.promise);
    const waitingSession = createSession({ historyHydrationState: "not_requested" });
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: waitingSession,
        agentStudioReadinessState: "checking",
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);

      await harness.update(
        createBaseArgs({
          activeSession: waitingSession,
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
        }),
      );
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "hydrated" }),
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
        }),
      );
      hydrationRequest.resolve();

      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);
    } finally {
      hydrationRequest.resolve();
      await harness.unmount();
    }
  });

  test("surfaces a real failure if readiness-triggered recovery also fails", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async () => {
      throw new Error("recovery failed");
    });
    const waitingSession = createSession({ historyHydrationState: "not_requested" });
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: waitingSession,
        agentStudioReadinessState: "checking",
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);

      await harness.update(
        createBaseArgs({
          activeSession: waitingSession,
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
        }),
      );
      await harness.waitFor((state) => state.isActiveSessionHistoryHydrationFailed);

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "not_requested" }),
          agentStudioReadinessState: "checking",
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(true);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "not_requested" }),
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("does not auto-retry a real post-ready hydration failure after readiness flaps", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async () => {
      throw new Error("post-ready failure");
    });
    const failedSession = createSession({ historyHydrationState: "not_requested" });
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: failedSession,
        agentStudioReadinessState: "ready",
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.isActiveSessionHistoryHydrationFailed);

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(false);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "failed" }),
          agentStudioReadinessState: "checking",
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(true);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({ historyHydrationState: "failed" }),
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(true);
      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("only auto-recovers the currently selected failed session after selection changes while waiting", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const firstFailedSession = createSession({
      sessionId: "session-1",
      externalSessionId: "external-1",
      historyHydrationState: "not_requested",
    });
    const secondFailedSession = createSession({
      sessionId: "session-2",
      externalSessionId: "external-2",
      historyHydrationState: "not_requested",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: firstFailedSession,
        agentStudioReadinessState: "checking",
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);

      await harness.update(
        createBaseArgs({
          activeSession: secondFailedSession,
          agentStudioReadinessState: "checking",
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);
      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();

      await harness.update(
        createBaseArgs({
          activeSession: secondFailedSession,
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
        }),
      );
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-2",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("recovers a waiting failed session after navigating away and back once readiness is healthy", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const failedSession = createSession({
      sessionId: "session-1",
      externalSessionId: "external-1",
      taskId: "task-1",
      historyHydrationState: "not_requested",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeTaskId: "task-1",
        activeSession: failedSession,
        agentStudioReadinessState: "checking",
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);

      await harness.update(
        createBaseArgs({
          activeTaskId: "task-2",
          activeSession: null,
          agentStudioReadinessState: "checking",
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(false);
      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();

      await harness.update(
        createBaseArgs({
          activeTaskId: "task-2",
          activeSession: null,
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();

      await harness.update(
        createBaseArgs({
          activeTaskId: "task-1",
          activeSession: failedSession,
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
        }),
      );
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("waits for a build session runtime attachment before hydrating restored session history", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const retrySessionRuntimeAttachment = mock(async (): Promise<boolean> => false);
    const buildSessionWaitingForRuntime = createSession({
      role: "build",
      scenario: "build_implementation_start",
      status: "stopped",
      runId: null,
      runtimeId: null,
      runtimeRoute: null,
      historyHydrationState: "not_requested",
    });
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: buildSessionWaitingForRuntime,
        agentStudioReadinessState: "ready",
        hydrateRequestedTaskSessionHistory,
        retrySessionRuntimeAttachment,
      }),
    );

    try {
      await harness.mount();

      expect(retrySessionRuntimeAttachment).toHaveBeenCalledTimes(1);
      expect(retrySessionRuntimeAttachment).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
        recoveryDedupKey: "/repo-a::task-1::session-1::attempt:1",
      });
      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().isWaitingForRuntimeReadiness).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({
            role: "build",
            scenario: "build_implementation_start",
            status: "stopped",
            runId: "run-1",
            runtimeId: null,
            runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
            historyHydrationState: "not_requested",
          }),
          agentStudioReadinessState: "ready",
          hydrateRequestedTaskSessionHistory,
          retrySessionRuntimeAttachment,
        }),
      );

      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("retries build runtime attachment recovery when recovery candidates change", async () => {
    const retrySessionRuntimeAttachment = mock(async (): Promise<boolean> => false);
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({
          role: "build",
          scenario: "build_implementation_start",
          status: "stopped",
          runId: null,
          runtimeId: null,
          runtimeRoute: null,
          historyHydrationState: "not_requested",
        }),
        agentStudioReadinessState: "ready",
        retrySessionRuntimeAttachment,
        runtimeAttachmentCandidates: [],
      }),
    );

    try {
      await harness.mount();
      expect(retrySessionRuntimeAttachment).toHaveBeenCalledTimes(1);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({
            role: "build",
            scenario: "build_implementation_start",
            status: "stopped",
            runId: null,
            runtimeId: null,
            runtimeRoute: null,
            historyHydrationState: "not_requested",
          }),
          agentStudioReadinessState: "ready",
          retrySessionRuntimeAttachment,
          runtimeAttachmentCandidates: [],
        }),
      );

      expect(retrySessionRuntimeAttachment).toHaveBeenCalledTimes(1);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({
            role: "build",
            scenario: "build_implementation_start",
            status: "stopped",
            runId: null,
            runtimeId: null,
            runtimeRoute: null,
            historyHydrationState: "not_requested",
          }),
          agentStudioReadinessState: "ready",
          retrySessionRuntimeAttachment,
          runtimeAttachmentCandidates: [
            {
              runtimeKind: "opencode",
              runtimeId: "runtime-1",
              workingDirectory: "/repo-a",
              route: "http://127.0.0.1:4444",
            },
          ],
        }),
      );

      expect(retrySessionRuntimeAttachment).toHaveBeenCalledTimes(2);
      expect(retrySessionRuntimeAttachment).toHaveBeenLastCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
        recoveryDedupKey: "/repo-a::task-1::session-1::attempt:2",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes runtime recovery sources while waiting for a session runtime", async () => {
    const refreshRuntimeAttachmentSources = mock(async (): Promise<void> => {});
    const timerOwner = typeof window === "undefined" ? globalThis : window;
    const originalSetInterval = timerOwner.setInterval;
    const originalClearInterval = timerOwner.clearInterval;
    const intervalCallbacks: Array<() => void> = [];

    timerOwner.setInterval = ((callback: TimerHandler) => {
      if (typeof callback === "function") {
        intervalCallbacks.push(callback as () => void);
      }
      return intervalCallbacks.length as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof timerOwner.setInterval;
    timerOwner.clearInterval = (() => undefined) as typeof timerOwner.clearInterval;

    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({
          role: "build",
          scenario: "build_implementation_start",
          status: "stopped",
          runId: null,
          runtimeId: null,
          runtimeRoute: null,
          historyHydrationState: "not_requested",
        }),
        refreshRuntimeAttachmentSources,
      }),
    );

    try {
      await harness.mount();
      expect(intervalCallbacks).toHaveLength(1);

      intervalCallbacks[0]?.();
      expect(refreshRuntimeAttachmentSources).toHaveBeenCalledTimes(1);
    } finally {
      timerOwner.setInterval = originalSetInterval;
      timerOwner.clearInterval = originalClearInterval;
      await harness.unmount();
    }
  });

  test("skips requested history hydration for a live session that already has local messages", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({
          status: "running",
          historyHydrationState: "hydrated",
          messages: [
            {
              id: "kickoff",
              role: "user",
              content: "Kickoff prompt",
              timestamp: "2026-02-22T08:00:05.000Z",
            },
          ],
        }),
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();

      expect(hydrateRequestedTaskSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().isActiveSessionHistoryHydrated).toBe(true);
      expect(harness.getLatest().isActiveSessionHistoryHydrating).toBe(false);
      expect(harness.getLatest().isActiveSessionHistoryHydrationFailed).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("still hydrates when a reused live session only has newly added local messages", async () => {
    const hydrateRequestedTaskSessionHistory = mock(async (): Promise<void> => {});
    const harness = createHookHarness(
      createBaseArgs({
        activeSession: createSession({
          status: "running",
          historyHydrationState: "not_requested",
          messages: [
            {
              id: "local-user-message",
              role: "user",
              content: "Generate the PR",
              timestamp: "2026-02-22T08:00:05.000Z",
            },
          ],
        }),
        hydrateRequestedTaskSessionHistory,
      }),
    );

    try {
      await harness.mount();
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      await harness.update(
        createBaseArgs({
          activeSession: createSession({
            status: "running",
            historyHydrationState: "hydrated",
            messages: [
              {
                id: "m-user",
                role: "user",
                content: "Earlier request",
                timestamp: "2026-02-22T08:00:00.000Z",
              },
              {
                id: "local-user-message",
                role: "user",
                content: "Generate the PR",
                timestamp: "2026-02-22T08:00:05.000Z",
              },
            ],
          }),
          hydrateRequestedTaskSessionHistory,
        }),
      );

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledTimes(1);
      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "task-1",
        sessionId: "session-1",
      });
    } finally {
      await harness.unmount();
    }
  });
});
