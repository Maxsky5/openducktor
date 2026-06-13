import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  ChatSettings,
  RuntimeInstanceSummary,
  SettingsSnapshot,
} from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createChatSettingsFixture,
  createDeferred,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
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
const replyAgentApproval = mock(async () => {});
const answerAgentQuestion = mock(async () => {});
const useAgentSessionMock = mock(
  (_externalSessionId: string | null): AgentSessionState | null => null,
);
let settingsChat: ChatSettings = createChatSettingsFixture();
let settingsSnapshotError: Error | null = null;
let runtimeList: RuntimeInstanceSummary[] = [];
let runtimeListError: Error | null = null;
let actualAppStateProvider: Awaited<typeof import("@/state/app-state-provider")>;
let actualAppStateContexts: Awaited<typeof import("@/state/app-state-contexts")>;
let actualHostOperations: Awaited<typeof import("@/state/operations/host")>;
let actualRepoRuntimeReadiness: Awaited<typeof import("../use-repo-runtime-readiness")>;
let originalHostRuntimeList: typeof import("@/state/operations/host").host.runtimeList;
let originalWorkspaceGetSettingsSnapshot: typeof import("@/state/operations/host").host.workspaceGetSettingsSnapshot;

function makeTranscriptSource(): RuntimeSessionTranscriptSource {
  return {
    runtimeKind: "opencode",
    workingDirectory: "/repo-a",
  };
}

function makePendingApproval() {
  return {
    requestId: "permission-1",
    requestType: "permission_grant" as const,
    title: `Approve permission: ${"file.read"}`,
    summary: `Approval request for ${"file.read"}.`,
    affectedPaths: ["src/app.ts"],
    action: { name: "file.read" },
    mutation: "read_only" as const,
    supportedReplyOutcomes: [
      "approve_once" as const,
      "approve_session" as const,
      "reject" as const,
    ],
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

function makeTranscriptSourceWithPendingApproval(): RuntimeSessionTranscriptSource {
  return {
    ...makeTranscriptSource(),
    pendingApprovals: [makePendingApproval()],
  };
}

function makeLiveTranscriptSession(): AgentSessionState {
  return {
    runtimeKind: "opencode",
    externalSessionId: "session-subagent-1",
    taskId: "task-a",
    repoPath: "/repo-a",
    role: "build",
    status: "running",
    startedAt: "2026-02-22T12:00:00.000Z",
    workingDirectory: "/repo-a",
    historyLoadState: "not_requested",
    messages: [],
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
    contextUsage: null,
    pendingApprovals: [makePendingApproval()],
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

function makeSettingsSnapshot(chat = settingsChat): SettingsSnapshot {
  return createSettingsSnapshotFixture({ chat });
}

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

describe("useSessionTranscriptSurfaceModel", () => {
  beforeAll(async () => {
    [
      actualAppStateProvider,
      actualAppStateContexts,
      actualHostOperations,
      actualRepoRuntimeReadiness,
    ] = await Promise.all([
      import("@/state/app-state-provider"),
      import("@/state/app-state-contexts"),
      import("@/state/operations/host"),
      import("../use-repo-runtime-readiness"),
    ]);
    originalHostRuntimeList = actualHostOperations.host.runtimeList;
    originalWorkspaceGetSettingsSnapshot = actualHostOperations.host.workspaceGetSettingsSnapshot;
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
    replyAgentApproval.mockClear();
    answerAgentQuestion.mockClear();
    useAgentSessionMock.mockClear();
    useAgentSessionMock.mockImplementation(
      (_externalSessionId: string | null): AgentSessionState | null => null,
    );
    settingsChat = createChatSettingsFixture();
    settingsSnapshotError = null;
    runtimeList = [makeRuntime()];
    runtimeListError = null;
    actualHostOperations.host.runtimeList = async () => {
      if (runtimeListError) {
        throw runtimeListError;
      }
      return runtimeList;
    };
    actualHostOperations.host.workspaceGetSettingsSnapshot = async () => {
      if (settingsSnapshotError) {
        throw settingsSnapshotError;
      }
      return makeSettingsSnapshot();
    };

    mock.module("@/state/app-state-provider", () => ({
      useActiveWorkspace: () => ({
        workspaceId: "workspace-a",
        workspaceName: "Workspace A",
        repoPath: "/repo-a",
      }),
      useAgentOperations: () => ({
        readSessionHistory,
        replyAgentApproval,
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

    mock.module("../use-repo-runtime-readiness", () => ({
      useRepoRuntimeReadiness: () => ({
        readinessState: "ready" as const,
        isReady: true,
        isRuntimeStarting: false,
        blockedReason: null,
        isLoadingChecks: false,
        refreshChecks: async () => {},
      }),
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/state/app-state-provider", () => Promise.resolve(actualAppStateProvider)],
      ["@/state/app-state-contexts", () => Promise.resolve(actualAppStateContexts)],
      ["../use-repo-runtime-readiness", () => Promise.resolve(actualRepoRuntimeReadiness)],
    ]);
    actualHostOperations.host.runtimeList = originalHostRuntimeList;
    actualHostOperations.host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  });

  test("loads a runtime transcript without task-owned session records", async () => {
    const transcriptSource = {
      ...makeTranscriptSource(),
      workingDirectory: "/repo-a/worktree",
    };
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
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
      await harness.waitFor(
        (state) => state.model.thread.session?.externalSessionId === "session-subagent-1",
      );

      expect(readSessionHistory).toHaveBeenCalledWith(
        "/repo-a",
        "opencode",
        "/repo-a/worktree",
        "session-subagent-1",
      );
      const session = harness.getLatest().model.thread.session as AgentSessionState;
      expect(session.externalSessionId).toBe("session-subagent-1");
      expect(session.messages).toBeTruthy();
      expect(harness.getLatest().model.chatSettings).toEqual(createChatSettingsFixture());
    } finally {
      await harness.unmount();
    }
  });

  test("passes explicit file diff expansion settings into the read-only chat surface", async () => {
    settingsChat = createChatSettingsFixture({ expandFileDiffsByDefault: false });
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-subagent-1",
        source: makeTranscriptSource(),
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.chatSettings.expandFileDiffsByDefault === false);

      expect(harness.getLatest().model.chatSettings).toEqual(
        createChatSettingsFixture({ expandFileDiffsByDefault: false }),
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses the requested dialog session id as the transcript target", async () => {
    const transcriptSource = makeTranscriptSource();
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-requested",
        source: transcriptSource,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(useAgentSessionMock).toHaveBeenCalledWith("session-requested");
      expect(readSessionHistory).toHaveBeenCalledWith(
        "/repo-a",
        "opencode",
        "/repo-a",
        "session-requested",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("does not load history while the dialog is closed", async () => {
    const transcriptSource = makeTranscriptSource();
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
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

  test("shows the default empty state when opened without a transcript source", async () => {
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: null,
        source: null,
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().model.thread.emptyState).toEqual({
        title: "Select a repository and session to view the conversation.",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("exposes the history loading state while transcript history is pending", async () => {
    const deferredHistory = createDeferred<AgentSessionHistoryMessage[]>();
    readSessionHistory.mockImplementationOnce(async () => deferredHistory.promise);
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-subagent-1",
        source: makeTranscriptSource(),
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(harness.getLatest().model.thread.isSessionViewLoading).toBe(true);
      expect(harness.getLatest().model.thread.isSessionHistoryLoading).toBe(true);
      expect(harness.getLatest().model.thread.emptyState).toBe(null);

      await harness.run(async () => {
        deferredHistory.resolve([
          {
            messageId: "message-user-1",
            role: "user" as const,
            timestamp: "2026-02-22T12:00:00.000Z",
            text: "Inspect this",
            displayParts: [],
            state: "read" as const,
            parts: [],
          },
        ]);
        await deferredHistory.promise;
      });
      await harness.waitFor((state) => state.model.thread.isSessionHistoryLoading === false);
    } finally {
      deferredHistory.resolve([]);
      await harness.unmount();
    }
  });

  test("loads existing history with parent-observed pending inputs", async () => {
    const transcriptSource = makeTranscriptSource();
    const pendingApproval = makePendingApproval();
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-subagent-1",
        source: {
          ...transcriptSource,
          pendingApprovals: [pendingApproval],
          pendingQuestions: [makePendingQuestion()],
        },
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);
      expect(readSessionHistory).toHaveBeenCalledWith(
        "/repo-a",
        "opencode",
        "/repo-a",
        "session-subagent-1",
      );
      await harness.waitFor(
        (state) => state.model.thread.session?.externalSessionId === "session-subagent-1",
      );
      expect(harness.getLatest().model.thread.session?.status).toBe("running");
    } finally {
      await harness.unmount();
    }
  });

  test("prefers an already-live transcript session when it exists locally", async () => {
    const pendingApproval = makePendingApproval();
    const liveSession = makeLiveTranscriptSession();
    useAgentSessionMock.mockImplementation((requestedSessionId: string | null) =>
      requestedSessionId === "session-subagent-1" ? liveSession : null,
    );
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-subagent-1",
        source: {
          ...makeTranscriptSource(),
          pendingApprovals: [pendingApproval],
        },
      },
      { wrapper },
    );

    try {
      await harness.mount();

      const model = harness.getLatest().model;
      expect(model.thread.session).toEqual(liveSession);
      expect(model.thread.isSessionViewLoading).toBe(false);
      expect(model.thread.isSessionHistoryLoading).toBe(false);
      expect(model.thread.canReplyToApprovals).toBe(true);
      expect(readSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps parent-observed subagent approvals on the transcript session", async () => {
    const transcriptSourceWithPendingApproval = makeTranscriptSourceWithPendingApproval();
    const pendingApproval = makePendingApproval();
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-subagent-1",
        source: transcriptSourceWithPendingApproval,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.session?.pendingApprovals.length === 1);

      const session = harness.getLatest().model.thread.session as AgentSessionState;
      expect(session.pendingApprovals).toEqual([pendingApproval]);
      expect(harness.getLatest().model.thread.canReplyToApprovals).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("replies to parent-observed approvals through the runtime transcript session", async () => {
    const transcriptSourceWithPendingApproval = makeTranscriptSourceWithPendingApproval();
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-subagent-1",
        source: transcriptSourceWithPendingApproval,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.canReplyToApprovals === true);

      await harness.run(async () => {
        await harness.getLatest().model.thread.onReplyApproval("permission-1", "approve_once");
      });

      expect(replyAgentApproval).toHaveBeenCalledWith(
        "session-subagent-1",
        "permission-1",
        "approve_once",
      );
      await harness.waitFor((state) => state.model.thread.session?.pendingApprovals.length === 0);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps and replies to parent-observed subagent questions through the runtime transcript session", async () => {
    const transcriptSourceWithPendingQuestion = makeTranscriptSourceWithPendingQuestion();
    const pendingQuestion = makePendingQuestion();
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
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
      await harness.waitFor((state) => state.model.thread.canSubmitQuestionAnswers === true);

      const session = harness.getLatest().model.thread.session as AgentSessionState;
      expect(session.pendingQuestions).toEqual([pendingQuestion]);
      await harness.run(async () => {
        await harness.getLatest().model.thread.onSubmitQuestionAnswers("question-1", [["A"]]);
      });

      expect(answerAgentQuestion).toHaveBeenCalledWith("session-subagent-1", "question-1", [["A"]]);
      await harness.waitFor((state) => state.model.thread.session?.pendingQuestions.length === 0);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps question submission disabled when the active session id does not match the transcript target", async () => {
    const transcriptSourceWithPendingQuestion = makeTranscriptSourceWithPendingQuestion();
    useAgentSessionMock.mockImplementation(() => ({
      ...makeLiveTranscriptSession(),
      externalSessionId: "session-other",
    }));
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-requested",
        source: transcriptSourceWithPendingQuestion,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.session !== null);

      expect(harness.getLatest().model.thread.canSubmitQuestionAnswers).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("surfaces a failed empty state when transcript history cannot load", async () => {
    const transcriptSource = makeTranscriptSource();
    readSessionHistory.mockImplementationOnce(async () => {
      throw new Error("history unavailable");
    });
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
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

  test("surfaces a failed empty state when chat settings cannot load", async () => {
    settingsSnapshotError = new Error("settings unavailable");
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        activeWorkspace: {
          workspaceId: "workspace-a",
          workspaceName: "Workspace A",
          repoPath: "/repo-a",
        },
        isOpen: true,
        externalSessionId: "session-subagent-1",
        source: makeTranscriptSource(),
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.emptyState !== null);

      expect(harness.getLatest().model.thread.emptyState).toEqual({
        title: "Failed to load conversation: Failed to load chat settings: settings unavailable",
      });
      expect(harness.getLatest().model.chatSettings).toEqual(createChatSettingsFixture());
    } finally {
      await harness.unmount();
    }
  });
});
