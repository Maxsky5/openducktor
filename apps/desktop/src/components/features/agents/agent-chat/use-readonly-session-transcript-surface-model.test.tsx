import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";

const hydrateRequestedTaskSessionHistory = mock(async () => {});
const ensureSessionReadyForView = mock(async () => true);
const useAgentSessionMock = mock((_sessionId: string | null) => null);

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
  beforeEach(() => {
    hydrateRequestedTaskSessionHistory.mockClear();
    ensureSessionReadyForView.mockClear();
    useAgentSessionMock.mockClear();

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
      useAgentChatSurfaceModel: () => ({
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
      }),
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => import("@/state/app-state-provider")],
      ["@/state/app-state-contexts", () => import("@/state/app-state-contexts")],
      ["@/state/queries/workspace", () => import("@/state/queries/workspace")],
      ["./use-repo-runtime-readiness", () => import("./use-repo-runtime-readiness")],
      [
        "./use-agent-chat-session-runtime-data",
        () => import("./use-agent-chat-session-runtime-data"),
      ],
      ["./use-agent-chat-session-hydration", () => import("./use-agent-chat-session-hydration")],
      ["./use-agent-chat-surface-model", () => import("./use-agent-chat-surface-model")],
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
});
