import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";

const hydrateRequestedTaskSessionHistory = mock(async () => {});
const ensureSessionReadyForView = mock(async () => true);
const useAgentSessionMock = mock((_sessionId: string | null) => null);
let latestSurfaceModelArgs: Record<string, unknown> | null = null;
let actualAppStateProvider: Awaited<typeof import("@/state/app-state-provider")>;
let actualAppStateContexts: Awaited<typeof import("@/state/app-state-contexts")>;
let actualWorkspaceQueries: Awaited<typeof import("@/state/queries/workspace")>;
let actualRepoRuntimeReadiness: Awaited<typeof import("./use-repo-runtime-readiness")>;
let actualRuntimeData: Awaited<typeof import("./use-agent-chat-session-runtime-data")>;
let actualSessionHydration: Awaited<typeof import("./use-agent-chat-session-hydration")>;
let actualSurfaceModel: Awaited<typeof import("./use-agent-chat-surface-model")>;

const persistedRecords: AgentSessionRecord[] = [
  {
    sessionId: "session-1",
    externalSessionId: "external-1",
    role: "build",
    scenario: "build_implementation_start",
    startedAt: "2026-02-22T12:00:00.000Z",
    runtimeKind: "opencode",
    workingDirectory: "/repo-a",
    selectedModel: null,
  },
];

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

describe("useReadonlySessionTranscriptSurfaceModel", () => {
  beforeAll(async () => {
    [
      actualAppStateProvider,
      actualAppStateContexts,
      actualWorkspaceQueries,
      actualRepoRuntimeReadiness,
      actualRuntimeData,
      actualSessionHydration,
      actualSurfaceModel,
    ] = await Promise.all([
      import("@/state/app-state-provider"),
      import("@/state/app-state-contexts"),
      import("@/state/queries/workspace"),
      import("./use-repo-runtime-readiness"),
      import("./use-agent-chat-session-runtime-data"),
      import("./use-agent-chat-session-hydration"),
      import("./use-agent-chat-surface-model"),
    ]);
  });

  beforeEach(() => {
    hydrateRequestedTaskSessionHistory.mockClear();
    ensureSessionReadyForView.mockClear();
    useAgentSessionMock.mockClear();
    latestSurfaceModelArgs = null;

    mock.module("@/state/app-state-provider", () => ({
      useAgentOperations: () => ({
        ensureSessionReadyForView,
        hydrateRequestedTaskSessionHistory,
        readSessionModelCatalog: async () => ({
          profiles: [],
          models: [],
        }),
        readSessionTodos: async () => [],
      }),
      useAgentSession: useAgentSessionMock,
      useChecksState: () => ({
        runtimeHealthByRuntime: {},
        isLoadingChecks: false,
        refreshChecks: async () => {},
      }),
    }));

    mock.module("@/state/app-state-contexts", () => ({
      useChecksOperationsContext: () => ({
        refreshRepoRuntimeHealthForRepo: async () => ({}),
        hasCachedRepoRuntimeHealth: () => true,
      }),
      useRuntimeDefinitionsContext: () => ({
        runtimeDefinitions: [],
        isLoadingRuntimeDefinitions: false,
        runtimeDefinitionsError: null,
      }),
    }));

    mock.module("@/state/queries/workspace", () => ({
      settingsSnapshotQueryOptions: () => ({
        queryKey: ["workspace", "settings-snapshot"],
        queryFn: async () => ({
          chat: {
            showThinkingMessages: false,
          },
        }),
      }),
    }));

    mock.module("./use-repo-runtime-readiness", () => ({
      useRepoRuntimeReadiness: () => ({
        readinessState: "ready" as const,
        isReady: true,
        blockedReason: null,
        isLoadingChecks: false,
        refreshChecks: async () => {},
      }),
    }));

    mock.module("./use-agent-chat-session-runtime-data", () => ({
      useAgentChatSessionRuntimeData: () => ({
        session: null,
        runtimeDataError: null,
      }),
    }));

    mock.module("./use-agent-chat-session-hydration", () => ({
      useAgentChatSessionHydration: () => ({
        isActiveTaskHydrated: true,
        isActiveTaskHydrationFailed: false,
        isActiveSessionHistoryHydrated: false,
        isActiveSessionHistoryHydrationFailed: false,
        isActiveSessionHistoryHydrating: false,
        isWaitingForRuntimeReadiness: false,
      }),
    }));

    mock.module("./use-agent-chat-surface-model", () => ({
      useAgentChatSurfaceModel: (args: Record<string, unknown>) => {
        latestSurfaceModelArgs = args;
        return {
          mode: "non_interactive" as const,
          thread: {
            session: null,
            isSessionWorking: false,
            showThinkingMessages: false,
            isSessionViewLoading: false,
            isSessionHistoryLoading: false,
            isWaitingForRuntimeReadiness: false,
            readinessState: "ready" as const,
            isInteractionEnabled: false,
            blockedReason: null,
            isLoadingChecks: false,
            onRefreshChecks: () => {},
            emptyState: null,
            isStarting: false,
            isSending: false,
            sessionAgentColors: {},
            canSubmitQuestionAnswers: false,
            isSubmittingQuestionByRequestId: {},
            onSubmitQuestionAnswers: async () => {},
            canReplyToPermissions: false,
            isSubmittingPermissionByRequestId: {},
            permissionReplyErrorByRequestId: {},
            onReplyPermission: async () => {},
            sessionRuntimeDataError: null,
            todoPanelCollapsed: true,
            onToggleTodoPanel: () => {},
            messagesContainerRef: { current: null },
            scrollToBottomOnSendRef: { current: null },
            syncBottomAfterComposerLayoutRef: { current: null },
          },
        };
      },
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => Promise.resolve(actualAppStateProvider)],
      ["@/state/app-state-contexts", () => Promise.resolve(actualAppStateContexts)],
      ["@/state/queries/workspace", () => Promise.resolve(actualWorkspaceQueries)],
      ["./use-repo-runtime-readiness", () => Promise.resolve(actualRepoRuntimeReadiness)],
      ["./use-agent-chat-session-runtime-data", () => Promise.resolve(actualRuntimeData)],
      ["./use-agent-chat-session-hydration", () => Promise.resolve(actualSessionHydration)],
      ["./use-agent-chat-surface-model", () => Promise.resolve(actualSurfaceModel)],
    ]);
  });

  test("hydrates a persisted transcript session when the live store is missing it", async () => {
    const { useReadonlySessionTranscriptSurfaceModel } = await import(
      "./use-readonly-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useReadonlySessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        taskId: "TASK-1",
        sessionId: "session-1",
        persistedRecords,
        isResolvingRequestedSession: false,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "TASK-1",
        sessionId: "session-1",
        persistedRecords,
      });
      expect(ensureSessionReadyForView).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("hydrates a fallback subagent session record when no persisted records exist", async () => {
    const { useReadonlySessionTranscriptSurfaceModel } = await import(
      "./use-readonly-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useReadonlySessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        taskId: "TASK-1",
        sessionId: "session-subagent-1",
        fallbackSession: {
          role: "build",
          runtimeKind: "opencode",
          workingDirectory: "/repo-a",
        },
        isResolvingRequestedSession: false,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => hydrateRequestedTaskSessionHistory.mock.calls.length === 1);

      expect(hydrateRequestedTaskSessionHistory).toHaveBeenCalledWith({
        taskId: "TASK-1",
        sessionId: "session-subagent-1",
        historyPreludeMode: "none",
        allowLiveSessionResume: false,
        persistedRecords: [
          {
            sessionId: "session-subagent-1",
            externalSessionId: "session-subagent-1",
            role: "build",
            scenario: "build_implementation_start",
            startedAt: "1970-01-01T00:00:00.000Z",
            runtimeKind: "opencode",
            workingDirectory: "/repo-a",
            selectedModel: null,
          },
        ],
      });
    } finally {
      await harness.unmount();
    }
  });

  test("shows a failure empty state when requested history hydration fails", async () => {
    hydrateRequestedTaskSessionHistory.mockImplementationOnce(async () => {
      throw new Error("hydrate boom");
    });
    const originalConsoleWarn = console.warn;
    const consoleWarn = mock(() => {});
    console.warn = consoleWarn;

    const { useReadonlySessionTranscriptSurfaceModel } = await import(
      "./use-readonly-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useReadonlySessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        taskId: "TASK-1",
        sessionId: "session-1",
        persistedRecords,
        isResolvingRequestedSession: false,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => latestSurfaceModelArgs?.emptyState !== null);

      expect(latestSurfaceModelArgs?.emptyState).toEqual({
        title: "Failed to load conversation.",
      });
      expect(consoleWarn).toHaveBeenCalled();
    } finally {
      console.warn = originalConsoleWarn;
      await harness.unmount();
    }
  });
});
