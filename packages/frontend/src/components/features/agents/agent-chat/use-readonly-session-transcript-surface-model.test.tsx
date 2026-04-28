import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { act } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentPermissionRequest, AgentSessionState } from "@/types/agent-orchestrator";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";

const readSessionHistory = mock(
  async (): Promise<AgentSessionHistoryMessage[]> => [
    {
      messageId: "message-user-1",
      role: "user" as const,
      timestamp: "2026-02-22T12:00:00.000Z",
      text: "Inspect this",
      displayParts: [],
      state: "read" as const,
      parts: [],
    },
  ],
);
const readSessionModelCatalog = mock(async () => ({ profiles: [], models: [] }));
const readSessionTodos = mock(async () => []);
const readRuntimeSessionPendingInput = mock(async (): Promise<AgentPermissionRequest[]> => []);
const replyAgentPermission = mock(async () => {});
const replyRuntimeSessionPermission = mock(async () => {});
const useAgentSessionMock = mock((_sessionId: string | null) => null);
let latestSurfaceModelArgs: Record<string, unknown> | null = null;
let runtimeList: RuntimeInstanceSummary[] = [];
let runtimeListError: Error | null = null;
let actualAppStateProvider: Awaited<typeof import("@/state/app-state-provider")>;
let actualAppStateContexts: Awaited<typeof import("@/state/app-state-contexts")>;
let actualWorkspaceQueries: Awaited<typeof import("@/state/queries/workspace")>;
let actualRuntimeQueries: Awaited<typeof import("@/state/queries/runtime")>;
let actualRepoRuntimeReadiness: Awaited<typeof import("./use-repo-runtime-readiness")>;
let actualRuntimeData: Awaited<typeof import("./use-agent-chat-session-runtime-data")>;
let actualSurfaceModel: Awaited<typeof import("./use-agent-chat-surface-model")>;

const transcriptSource: RuntimeSessionTranscriptSource = {
  runtimeKind: "opencode",
  runtimeId: "runtime-1",
  workingDirectory: "/repo-a",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4096",
  },
};

const transcriptSourceWithRuntimeIdOnly: RuntimeSessionTranscriptSource = {
  runtimeKind: "opencode",
  runtimeId: "runtime-1",
  workingDirectory: "/repo-a",
};

const pendingPermission = {
  requestId: "permission-1",
  permission: "file.read",
  patterns: ["src/app.ts"],
};

const transcriptSourceWithPendingPermission: RuntimeSessionTranscriptSource = {
  ...transcriptSource,
  pendingPermissions: [pendingPermission],
};

const liveTranscriptSource: RuntimeSessionTranscriptSource = {
  ...transcriptSource,
  isLive: true,
};

const runtime = {
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/repo-a",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo-a",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4096",
  },
  startedAt: "2026-02-22T11:59:00.000Z",
  descriptor: {} as RuntimeInstanceSummary["descriptor"],
} satisfies RuntimeInstanceSummary;

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

const installFakeIntervals = () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let nextIntervalId = 1;
  const intervalCallbacks = new Map<number, () => void>();

  globalThis.setInterval = ((callback: TimerHandler) => {
    const intervalId = nextIntervalId;
    nextIntervalId += 1;
    intervalCallbacks.set(intervalId, () => {
      if (typeof callback === "function") {
        callback();
      }
    });
    return intervalId as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof globalThis.setInterval;

  globalThis.clearInterval = ((intervalId: ReturnType<typeof setInterval>) => {
    intervalCallbacks.delete(Number(intervalId));
  }) as typeof globalThis.clearInterval;

  const fireIntervals = async (): Promise<void> => {
    const callbacks = [...intervalCallbacks.values()];
    await act(async () => {
      for (const callback of callbacks) {
        callback();
      }
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  return {
    fireIntervals,
    restore: () => {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };
};

describe("useReadonlySessionTranscriptSurfaceModel", () => {
  beforeAll(async () => {
    [
      actualAppStateProvider,
      actualAppStateContexts,
      actualWorkspaceQueries,
      actualRuntimeQueries,
      actualRepoRuntimeReadiness,
      actualRuntimeData,
      actualSurfaceModel,
    ] = await Promise.all([
      import("@/state/app-state-provider"),
      import("@/state/app-state-contexts"),
      import("@/state/queries/workspace"),
      import("@/state/queries/runtime"),
      import("./use-repo-runtime-readiness"),
      import("./use-agent-chat-session-runtime-data"),
      import("./use-agent-chat-surface-model"),
    ]);
  });

  beforeEach(() => {
    readSessionHistory.mockClear();
    readSessionHistory.mockImplementation(
      async (): Promise<AgentSessionHistoryMessage[]> => [
        {
          messageId: "message-user-1",
          role: "user" as const,
          timestamp: "2026-02-22T12:00:00.000Z",
          text: "Inspect this",
          displayParts: [],
          state: "read" as const,
          parts: [],
        },
      ],
    );
    readSessionModelCatalog.mockClear();
    readSessionTodos.mockClear();
    readRuntimeSessionPendingInput.mockClear();
    readRuntimeSessionPendingInput.mockImplementation(
      async (): Promise<AgentPermissionRequest[]> => [],
    );
    replyAgentPermission.mockClear();
    replyRuntimeSessionPermission.mockClear();
    useAgentSessionMock.mockClear();
    latestSurfaceModelArgs = null;
    runtimeList = [runtime];
    runtimeListError = null;

    mock.module("@/state/app-state-provider", () => ({
      useAgentOperations: () => ({
        readSessionHistory,
        readSessionModelCatalog,
        readSessionTodos,
        readRuntimeSessionPendingInput,
        replyAgentPermission,
        replyRuntimeSessionPermission,
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

    mock.module("@/state/queries/runtime", () => ({
      runtimeListQueryOptions: () => ({
        queryKey: ["runtime", "list", "opencode", "/repo-a"],
        queryFn: async () => {
          if (runtimeListError) {
            throw runtimeListError;
          }
          return runtimeList;
        },
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
      useAgentChatSessionRuntimeData: ({ session }: { session: AgentSessionState | null }) => ({
        session,
        runtimeDataError: null,
      }),
    }));

    mock.module("./use-agent-chat-surface-model", () => ({
      useAgentChatSurfaceModel: (args: Record<string, unknown>) => {
        latestSurfaceModelArgs = args;
        return {
          mode: "non_interactive" as const,
          thread: {
            session: args.session ?? null,
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
            emptyState: args.emptyState ?? null,
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
      ["@/state/queries/runtime", () => Promise.resolve(actualRuntimeQueries)],
      ["./use-repo-runtime-readiness", () => Promise.resolve(actualRepoRuntimeReadiness)],
      ["./use-agent-chat-session-runtime-data", () => Promise.resolve(actualRuntimeData)],
      ["./use-agent-chat-surface-model", () => Promise.resolve(actualSurfaceModel)],
    ]);
  });

  test("loads a runtime transcript without task-owned session records", async () => {
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
        isOpen: true,
        sessionId: "session-subagent-1",
        source: transcriptSource,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);
      await harness.waitFor(() => {
        const session = latestSurfaceModelArgs?.session as AgentSessionState | null | undefined;
        return session?.sessionId === "session-subagent-1";
      });

      expect(readSessionHistory).toHaveBeenCalledWith(
        "opencode",
        {
          type: "local_http",
          endpoint: "http://127.0.0.1:4096",
          workingDirectory: "/repo-a",
        },
        "session-subagent-1",
      );
      const session = latestSurfaceModelArgs?.session as AgentSessionState;
      expect(session.externalSessionId).toBe("session-subagent-1");
      expect(session.messages).toBeTruthy();
    } finally {
      await harness.unmount();
    }
  });

  test("does not load history while the dialog is closed", async () => {
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
        isOpen: false,
        sessionId: "session-subagent-1",
        source: transcriptSource,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("refreshes live runtime pending permissions and history while open", async () => {
    const { fireIntervals, restore } = installFakeIntervals();
    let historyResponse: AgentSessionHistoryMessage[] = [
      {
        messageId: "message-user-1",
        role: "user" as const,
        timestamp: "2026-02-22T12:00:00.000Z",
        text: "Inspect this",
        displayParts: [],
        state: "read" as const,
        parts: [],
      },
    ];
    let pendingPermissionsResponse: AgentPermissionRequest[] = [];

    readSessionHistory.mockImplementation(
      async (): Promise<AgentSessionHistoryMessage[]> => historyResponse,
    );
    readRuntimeSessionPendingInput.mockImplementation(
      async (): Promise<AgentPermissionRequest[]> => pendingPermissionsResponse,
    );
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
        isOpen: true,
        sessionId: "session-subagent-1",
        source: {
          ...liveTranscriptSource,
          pendingPermissions: [pendingPermission],
        },
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(
        () =>
          readSessionHistory.mock.calls.length === 1 &&
          readRuntimeSessionPendingInput.mock.calls.length === 1,
      );
      await harness.waitFor(() => {
        const session = latestSurfaceModelArgs?.session as AgentSessionState | null | undefined;
        return session?.pendingPermissions.length === 0;
      });
      expect(latestSurfaceModelArgs?.permissions).toMatchObject({ canReply: false });

      historyResponse = [
        {
          messageId: "message-user-1",
          role: "user" as const,
          timestamp: "2026-02-22T12:00:00.000Z",
          text: "Inspect this",
          displayParts: [],
          state: "read" as const,
          parts: [],
        },
        {
          messageId: "message-assistant-1",
          role: "assistant" as const,
          timestamp: "2026-02-22T12:00:01.000Z",
          text: "Working on it",
          parts: [],
        },
      ];
      pendingPermissionsResponse = [pendingPermission];
      await fireIntervals();
      await harness.waitFor(
        () =>
          readSessionHistory.mock.calls.length === 2 &&
          readRuntimeSessionPendingInput.mock.calls.length === 2,
      );
      await harness.waitFor(() => {
        const session = latestSurfaceModelArgs?.session as AgentSessionState | null | undefined;
        return session?.pendingPermissions.length === 1;
      });

      const session = latestSurfaceModelArgs?.session as AgentSessionState;
      expect(session.pendingPermissions).toEqual([pendingPermission]);
      expect(readSessionHistory).toHaveBeenCalledTimes(2);
      expect(readRuntimeSessionPendingInput).toHaveBeenCalledTimes(2);
      expect(latestSurfaceModelArgs?.permissions).toMatchObject({ canReply: true });
    } finally {
      await harness.unmount();
      restore();
    }
  });

  test("keeps parent-observed subagent permissions on the transcript session", async () => {
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
        isOpen: true,
        sessionId: "session-subagent-1",
        source: transcriptSourceWithPendingPermission,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => {
        const session = latestSurfaceModelArgs?.session as AgentSessionState | null | undefined;
        return session?.pendingPermissions.length === 1;
      });

      const session = latestSurfaceModelArgs?.session as AgentSessionState;
      expect(session.pendingPermissions).toEqual([pendingPermission]);
      expect(latestSurfaceModelArgs?.permissions).toMatchObject({ canReply: true });
    } finally {
      await harness.unmount();
    }
  });

  test("replies to parent-observed permissions through the runtime transcript session", async () => {
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
        isOpen: true,
        sessionId: "session-subagent-1",
        source: transcriptSourceWithPendingPermission,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => {
        const permissions = latestSurfaceModelArgs?.permissions as
          | { canReply: boolean }
          | undefined;
        return permissions?.canReply === true;
      });

      const permissions = latestSurfaceModelArgs?.permissions as {
        onReply: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
      };
      await permissions.onReply("permission-1", "once");

      expect(replyRuntimeSessionPermission).toHaveBeenCalledWith({
        runtimeKind: "opencode",
        runtimeConnection: {
          type: "local_http",
          endpoint: "http://127.0.0.1:4096",
          workingDirectory: "/repo-a",
        },
        externalSessionId: "session-subagent-1",
        requestId: "permission-1",
        reply: "once",
      });
      expect(replyAgentPermission).not.toHaveBeenCalled();
      await harness.waitFor(() => {
        const session = latestSurfaceModelArgs?.session as AgentSessionState | null | undefined;
        return session?.pendingPermissions.length === 0;
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces a failed empty state when transcript history cannot load", async () => {
    readSessionHistory.mockImplementationOnce(async () => {
      throw new Error("history unavailable");
    });
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
        isOpen: true,
        sessionId: "session-subagent-1",
        source: transcriptSource,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.emptyState !== null);

      expect(readSessionHistory).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().model.thread.emptyState).toEqual({
        title: "Failed to load conversation: history unavailable",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces an unavailable state when the source runtime is not attached", async () => {
    runtimeList = [];
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
        isOpen: true,
        sessionId: "session-subagent-1",
        source: transcriptSourceWithRuntimeIdOnly,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.emptyState !== null);

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(latestSurfaceModelArgs?.isSessionHistoryLoading).toBe(false);
      expect(harness.getLatest().model.thread.emptyState).toEqual({
        title: "Failed to load conversation: No opencode runtime is attached for /repo-a.",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces runtime list failures without converting them to missing runtimes", async () => {
    runtimeListError = new Error("runtime registry unavailable");
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
        isOpen: true,
        sessionId: "session-subagent-1",
        source: transcriptSourceWithRuntimeIdOnly,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.emptyState !== null);

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(latestSurfaceModelArgs?.isSessionHistoryLoading).toBe(false);
      expect(harness.getLatest().model.thread.emptyState).toEqual({
        title: "Failed to load conversation: runtime registry unavailable",
      });
    } finally {
      await harness.unmount();
    }
  });
});
