import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
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
const attachRuntimeTranscriptSession = mock(async () => {});
const replyAgentPermission = mock(async () => {});
const answerAgentQuestion = mock(async () => {});
const useAgentSessionMock = mock(
  (_externalSessionId: string | null): AgentSessionState | null => null,
);
let latestSurfaceModelArgs: Record<string, unknown> | null = null;
let runtimeList: RuntimeInstanceSummary[] = [];
let runtimeListError: Error | null = null;
let actualAppStateProvider: Awaited<typeof import("@/state/app-state-provider")>;
let actualAppStateContexts: Awaited<typeof import("@/state/app-state-contexts")>;
let actualHostOperations: Awaited<typeof import("@/state/operations/host")>;
let actualWorkspaceQueries: Awaited<typeof import("@/state/queries/workspace")>;
let actualRepoRuntimeReadiness: Awaited<typeof import("./use-repo-runtime-readiness")>;
let actualRuntimeData: Awaited<typeof import("./use-agent-chat-session-runtime-data")>;
let actualSurfaceModel: Awaited<typeof import("./use-agent-chat-surface-model")>;
let originalHostRuntimeList: typeof import("@/state/operations/host").host.runtimeList;

function makeTranscriptSource(): RuntimeSessionTranscriptSource {
  return {
    runtimeKind: "opencode",
    runtimeId: "runtime-1",
    workingDirectory: "/repo-a",
  };
}

function makeTranscriptSourceWithRuntimeIdOnly(): RuntimeSessionTranscriptSource {
  return {
    runtimeKind: "opencode",
    runtimeId: "runtime-1",
    workingDirectory: "/repo-a",
  };
}

function makePendingPermission() {
  return {
    requestId: "permission-1",
    permission: "file.read",
    patterns: ["src/app.ts"],
  };
}

function makePendingQuestion() {
  return {
    requestId: "question-1",
    questions: [
      {
        header: "Choose path",
        question: "Which path should the subagent use?",
        options: [{ label: "A", description: "Path A" }],
      },
    ],
  };
}

function makeTranscriptSourceWithPendingQuestion(): RuntimeSessionTranscriptSource {
  return {
    ...makeTranscriptSource(),
    pendingQuestions: [makePendingQuestion()],
  };
}

function makeTranscriptSourceWithPendingPermission(): RuntimeSessionTranscriptSource {
  return {
    ...makeTranscriptSource(),
    pendingPermissions: [makePendingPermission()],
  };
}

function makeLiveTranscriptSource(): RuntimeSessionTranscriptSource {
  return {
    ...makeTranscriptSource(),
    isLive: true,
  };
}

function makeLiveTranscriptSession(): AgentSessionState {
  return {
    runtimeKind: "opencode",
    externalSessionId: "session-subagent-1",
    purpose: "transcript",
    taskId: "",
    repoPath: "/repo-a",
    role: null as unknown as AgentSessionState["role"],
    scenario: null as unknown as AgentSessionState["scenario"],
    status: "running",
    startedAt: "2026-02-22T12:00:00.000Z",
    runtimeId: "runtime-1",
    workingDirectory: "/repo-a",
    messages: [],
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
    contextUsage: null,
    pendingPermissions: [makePendingPermission()],
    pendingQuestions: [makePendingQuestion()],
    todos: [],
    modelCatalog: null,
    selectedModel: null,
    isLoadingModelCatalog: false,
  };
}

function makeRuntime(): RuntimeInstanceSummary {
  return {
    kind: "opencode",
    runtimeId: "runtime-1",
    repoPath: "/repo-a",
    taskId: null,
    role: "workspace",
    workingDirectory: "/repo-a",
    runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
    startedAt: "2026-02-22T11:59:00.000Z",
    descriptor: {} as RuntimeInstanceSummary["descriptor"],
  } satisfies RuntimeInstanceSummary;
}

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

describe("useReadonlySessionTranscriptSurfaceModel", () => {
  beforeAll(async () => {
    [
      actualAppStateProvider,
      actualAppStateContexts,
      actualHostOperations,
      actualWorkspaceQueries,
      actualRepoRuntimeReadiness,
      actualRuntimeData,
      actualSurfaceModel,
    ] = await Promise.all([
      import("@/state/app-state-provider"),
      import("@/state/app-state-contexts"),
      import("@/state/operations/host"),
      import("@/state/queries/workspace"),
      import("./use-repo-runtime-readiness"),
      import("./use-agent-chat-session-runtime-data"),
      import("./use-agent-chat-surface-model"),
    ]);
    originalHostRuntimeList = actualHostOperations.host.runtimeList;
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
    attachRuntimeTranscriptSession.mockClear();
    attachRuntimeTranscriptSession.mockImplementation(async () => {});
    replyAgentPermission.mockClear();
    answerAgentQuestion.mockClear();
    useAgentSessionMock.mockClear();
    useAgentSessionMock.mockImplementation(
      (_externalSessionId: string | null): AgentSessionState | null => null,
    );
    latestSurfaceModelArgs = null;
    runtimeList = [makeRuntime()];
    runtimeListError = null;
    actualHostOperations.host.runtimeList = async () => {
      if (runtimeListError) {
        throw runtimeListError;
      }
      return runtimeList;
    };

    mock.module("@/state/app-state-provider", () => ({
      useActiveWorkspace: () => ({
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      }),
      useAgentOperations: () => ({
        readSessionHistory,
        attachRuntimeTranscriptSession,
        readSessionModelCatalog,
        readSessionTodos,
        replyAgentPermission,
        answerAgentQuestion,
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
      ["./use-repo-runtime-readiness", () => Promise.resolve(actualRepoRuntimeReadiness)],
      ["./use-agent-chat-session-runtime-data", () => Promise.resolve(actualRuntimeData)],
      ["./use-agent-chat-surface-model", () => Promise.resolve(actualSurfaceModel)],
    ]);
    actualHostOperations.host.runtimeList = originalHostRuntimeList;
  });

  test("loads a runtime transcript without task-owned session records", async () => {
    const transcriptSource = {
      ...makeTranscriptSource(),
      workingDirectory: "/repo-a/worktree",
    };
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
        externalSessionId: "session-subagent-1",
        source: transcriptSource,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);
      await harness.waitFor(() => {
        const session = latestSurfaceModelArgs?.session as AgentSessionState | null | undefined;
        return session?.externalSessionId === "session-subagent-1";
      });

      expect(readSessionHistory).toHaveBeenCalledWith(
        "/repo-a",
        "opencode",
        "/repo-a/worktree",
        "session-subagent-1",
        "runtime-1",
      );
      const session = latestSurfaceModelArgs?.session as AgentSessionState;
      expect(session.externalSessionId).toBe("session-subagent-1");
      expect(session.messages).toBeTruthy();
    } finally {
      await harness.unmount();
    }
  });

  test("does not load history while the dialog is closed", async () => {
    const transcriptSource = makeTranscriptSource();
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
        externalSessionId: "session-subagent-1",
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

  test("attaches live runtime transcripts to the session event stream without polling", async () => {
    const liveTranscriptSource = makeLiveTranscriptSource();
    const pendingPermission = makePendingPermission();
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
        externalSessionId: "session-subagent-1",
        source: {
          ...liveTranscriptSource,
          pendingPermissions: [pendingPermission],
          pendingQuestions: [makePendingQuestion()],
        },
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => attachRuntimeTranscriptSession.mock.calls.length === 1);

      expect(attachRuntimeTranscriptSession).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        externalSessionId: "session-subagent-1",
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        pendingPermissions: [pendingPermission],
        pendingQuestions: [makePendingQuestion()],
        workingDirectory: "/repo-a",
      });
      expect(readSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("does not keep the live transcript loading after the session is visible", async () => {
    const liveTranscriptSource = makeLiveTranscriptSource();
    const pendingPermission = makePendingPermission();
    const liveSession = makeLiveTranscriptSession();
    const resolveAttachCallbacks: Array<() => void> = [];
    attachRuntimeTranscriptSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAttachCallbacks.push(resolve);
        }),
    );
    useAgentSessionMock.mockImplementation((requestedSessionId: string | null) =>
      requestedSessionId === "session-subagent-1" ? liveSession : null,
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
        externalSessionId: "session-subagent-1",
        source: {
          ...liveTranscriptSource,
          pendingPermissions: [pendingPermission],
        },
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => attachRuntimeTranscriptSession.mock.calls.length === 1);

      expect(latestSurfaceModelArgs?.session).toEqual(liveSession);
      expect(latestSurfaceModelArgs?.isTaskHydrating).toBe(false);
      expect(latestSurfaceModelArgs?.isSessionHistoryLoading).toBe(false);
      expect(latestSurfaceModelArgs?.permissions).toMatchObject({ canReply: true });
    } finally {
      resolveAttachCallbacks[0]?.();
      await harness.unmount();
    }
  });

  test("keeps parent-observed subagent permissions on the transcript session", async () => {
    const transcriptSourceWithPendingPermission = makeTranscriptSourceWithPendingPermission();
    const pendingPermission = makePendingPermission();
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
        externalSessionId: "session-subagent-1",
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
    const transcriptSourceWithPendingPermission = makeTranscriptSourceWithPendingPermission();
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
        externalSessionId: "session-subagent-1",
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
      await harness.run(async () => {
        await permissions.onReply("permission-1", "once");
      });

      expect(replyAgentPermission).toHaveBeenCalledWith(
        "session-subagent-1",
        "permission-1",
        "once",
      );
      await harness.waitFor(() => {
        const session = latestSurfaceModelArgs?.session as AgentSessionState | null | undefined;
        return session?.pendingPermissions.length === 0;
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps and replies to parent-observed subagent questions through the runtime transcript session", async () => {
    const transcriptSourceWithPendingQuestion = makeTranscriptSourceWithPendingQuestion();
    const pendingQuestion = makePendingQuestion();
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
        externalSessionId: "session-subagent-1",
        source: transcriptSourceWithPendingQuestion,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => {
        const pendingQuestions = latestSurfaceModelArgs?.pendingQuestions as
          | { canSubmit: boolean }
          | undefined;
        return pendingQuestions?.canSubmit === true;
      });

      const session = latestSurfaceModelArgs?.session as AgentSessionState;
      expect(session.pendingQuestions).toEqual([pendingQuestion]);
      const pendingQuestions = latestSurfaceModelArgs?.pendingQuestions as {
        onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
      };
      await harness.run(async () => {
        await pendingQuestions.onSubmit("question-1", [["A"]]);
      });

      expect(answerAgentQuestion).toHaveBeenCalledWith("session-subagent-1", "question-1", [["A"]]);
      await harness.waitFor(() => {
        const nextSession = latestSurfaceModelArgs?.session as AgentSessionState | null | undefined;
        return nextSession?.pendingQuestions.length === 0;
      });
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces a failed empty state when transcript history cannot load", async () => {
    const transcriptSource = makeTranscriptSource();
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
        externalSessionId: "session-subagent-1",
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
    const transcriptSourceWithRuntimeIdOnly = makeTranscriptSourceWithRuntimeIdOnly();
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
        externalSessionId: "session-subagent-1",
        source: transcriptSourceWithRuntimeIdOnly,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.emptyState !== null);

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(latestSurfaceModelArgs?.isSessionHistoryLoading).toBe(false);
      expect(latestSurfaceModelArgs?.permissions).toMatchObject({ canReply: false });
      await (
        latestSurfaceModelArgs?.permissions as {
          onReply: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
        }
      ).onReply("permission-1", "once");
      expect(harness.getLatest().model.thread.emptyState).toEqual({
        title: "Failed to load conversation: No opencode runtime is attached for runtime-1.",
      });
      expect(replyAgentPermission).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces runtime list failures without converting them to missing runtimes", async () => {
    const transcriptSourceWithRuntimeIdOnly = makeTranscriptSourceWithRuntimeIdOnly();
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
        externalSessionId: "session-subagent-1",
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

  test("surfaces an ambiguous runtime attachment as unresolved and blocks permission replies", async () => {
    const transcriptSourceWithRuntimeIdOnly = makeTranscriptSourceWithRuntimeIdOnly();
    runtimeList = [makeRuntime(), makeRuntime()];
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
        externalSessionId: "session-subagent-1",
        source: transcriptSourceWithRuntimeIdOnly,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.emptyState !== null);

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(latestSurfaceModelArgs?.permissions).toMatchObject({ canReply: false });
      await (
        latestSurfaceModelArgs?.permissions as {
          onReply: (requestId: string, reply: "once" | "always" | "reject") => Promise<void>;
        }
      ).onReply("permission-1", "once");
      expect(harness.getLatest().model.thread.emptyState).toEqual({
        title: "Failed to load conversation: Multiple opencode runtime is attached for runtime-1.",
      });
      expect(replyAgentPermission).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });
});
