import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatSettings, SettingsSnapshot } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import { createAgentSessionCollection } from "@/state/agent-session-collection";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import {
  AgentOperationsContext,
  AgentSessionsContext,
  ChecksStateContext,
  RuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import {
  createChatSettingsFixture,
  createDeferred,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue, ChecksStateContextValue } from "@/types/state-slices";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";

type RepoRuntimeReadinessArgs = Parameters<
  typeof import("@/lib/use-repo-runtime-readiness").useRepoRuntimeReadiness
>[0];

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
let settingsChat: ChatSettings = createChatSettingsFixture();
let settingsSnapshotError: Error | null = null;
let actualHostOperations: Awaited<typeof import("@/state/operations/host")>;
let actualRepoRuntimeReadiness: Awaited<typeof import("@/lib/use-repo-runtime-readiness")>;
let originalWorkspaceGetSettingsSnapshot: typeof import("@/state/operations/host").host.workspaceGetSettingsSnapshot;
let sessionStore = createAgentSessionsStore("/repo-a");
let runtimeReadiness: RepoRuntimeReadiness = {
  readinessState: "ready",
  isReady: true,
  isRuntimeStarting: false,
  blockedReason: null,
  isLoadingChecks: false,
  refreshChecks: async () => {},
};
let runtimeReadinessCalls: RepoRuntimeReadinessArgs[] = [];

function makeTranscriptTarget(overrides: Partial<AgentSessionIdentity> = {}): AgentSessionIdentity {
  return {
    externalSessionId: "session-subagent-1",
    runtimeKind: "opencode",
    workingDirectory: "/repo-a",
    ...overrides,
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

function makeLiveTranscriptSession(): AgentSessionState {
  return {
    runtimeKind: "opencode",
    externalSessionId: "session-subagent-1",
    taskId: "task-a",
    role: "build",
    status: "running",
    startedAt: "2026-02-22T12:00:00.000Z",
    workingDirectory: "/repo-a",
    historyLoadState: "not_requested",
    messages: createSessionMessagesState("session-subagent-1"),
    contextUsage: null,
    pendingApprovals: [makePendingApproval()],
    pendingQuestions: [makePendingQuestion()],
    selectedModel: null,
  };
}

function setLiveTranscriptSessions(...sessions: AgentSessionState[]): void {
  sessionStore.setSessionCollection(createAgentSessionCollection(sessions));
}

function makeSettingsSnapshot(chat = settingsChat): SettingsSnapshot {
  return createSettingsSnapshotFixture({ chat });
}

function agentOperationsValue(): AgentOperationsContextValue {
  return {
    readSessionHistory,
    readSessionTodos: async () => [],
    startAgentSession: async () => ({
      externalSessionId: "session-started",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
    }),
    sendAgentMessage: async () => undefined,
    stopAgentSession: async () => undefined,
    updateAgentSessionModel: () => undefined,
    replyAgentApproval,
    answerAgentQuestion,
  };
}

function checksStateValue(): ChecksStateContextValue {
  return {
    runtimeCheck: null,
    taskStoreCheck: null,
    runtimeCheckFailureKind: null,
    taskStoreCheckFailureKind: null,
    runtimeHealthByRuntime: {},
    isLoadingChecks: false,
    refreshChecks: async () => undefined,
  };
}

function runtimeDefinitionsValue() {
  return {
    runtimeDefinitions: [],
    availableRuntimeDefinitions: [],
    agentRuntimes: {},
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    refreshRuntimeDefinitions: async () => [],
    loadRepoRuntimeCatalog: async () => ({
      providers: [],
      models: [],
      variants: [],
      profiles: [],
      defaultModelsByProvider: {},
    }),
    loadRepoRuntimeSlashCommands: async () => ({
      commands: [],
    }),
    loadRepoRuntimeSkills: async () => ({ skills: [] }),
    loadRepoRuntimeFileSearch: async () => [],
  };
}

const wrapper = ({ children }: PropsWithChildren): ReactElement => (
  <QueryProvider useIsolatedClient>
    <AgentOperationsContext.Provider value={agentOperationsValue()}>
      <AgentSessionsContext.Provider value={sessionStore}>
        <ChecksStateContext.Provider value={checksStateValue()}>
          <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsValue()}>
            {children}
          </RuntimeDefinitionsContext.Provider>
        </ChecksStateContext.Provider>
      </AgentSessionsContext.Provider>
    </AgentOperationsContext.Provider>
  </QueryProvider>
);

describe("useSessionTranscriptSurfaceModel", () => {
  beforeAll(async () => {
    [actualHostOperations, actualRepoRuntimeReadiness] = await Promise.all([
      import("@/state/operations/host"),
      import("@/lib/use-repo-runtime-readiness"),
    ]);
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
    sessionStore = createAgentSessionsStore("/repo-a");
    settingsChat = createChatSettingsFixture();
    settingsSnapshotError = null;
    runtimeReadiness = {
      readinessState: "ready",
      isReady: true,
      isRuntimeStarting: false,
      blockedReason: null,
      isLoadingChecks: false,
      refreshChecks: async () => {},
    };
    runtimeReadinessCalls = [];
    actualHostOperations.host.workspaceGetSettingsSnapshot = async () => {
      if (settingsSnapshotError) {
        throw settingsSnapshotError;
      }
      return makeSettingsSnapshot();
    };

    mock.module("@/lib/use-repo-runtime-readiness", () => ({
      useRepoRuntimeReadiness: (args: RepoRuntimeReadinessArgs) => {
        runtimeReadinessCalls.push(args);
        return runtimeReadiness;
      },
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/lib/use-repo-runtime-readiness", () => Promise.resolve(actualRepoRuntimeReadiness)],
    ]);
    actualHostOperations.host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
  });

  test("loads a runtime transcript without task-owned session records", async () => {
    const transcriptTarget = makeTranscriptTarget({
      workingDirectory: "/repo-a/worktree",
    });
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: transcriptTarget,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);
      await harness.waitFor(
        (state) => state.model.thread.session?.externalSessionId === "session-subagent-1",
      );

      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a/worktree",
        externalSessionId: "session-subagent-1",
      });
      const session = harness.getLatest().model.thread.session as AgentChatThreadSession;
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
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget(),
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
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget({ externalSessionId: "session-requested" }),
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a",
        externalSessionId: "session-requested",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("scopes runtime readiness to the transcript target runtime", async () => {
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget({ runtimeKind: "codex" }),
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(runtimeReadinessCalls.at(-1)?.runtimeTarget).toEqual({
        kind: "runtime",
        runtimeKind: "codex",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not load history while the dialog is closed", async () => {
    const transcriptTarget = makeTranscriptTarget();
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: false,
        target: transcriptTarget,
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

  test("shows the default empty state when opened without a transcript target", async () => {
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: null,
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
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget(),
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);

      expect(harness.getLatest().model.thread.transcriptState).toEqual({
        kind: "session_loading",
        reason: "history",
      });
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
      await harness.waitFor((state) => state.model.thread.transcriptState.kind === "visible");
    } finally {
      deferredHistory.resolve([]);
      await harness.unmount();
    }
  });

  test("uses the canonical runtime waiting transcript state while runtime readiness is checking", async () => {
    runtimeReadiness = {
      readinessState: "checking",
      isReady: false,
      isRuntimeStarting: true,
      blockedReason: null,
      isLoadingChecks: true,
      refreshChecks: async () => {},
    };
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget(),
      },
      { wrapper },
    );

    try {
      await harness.mount();

      expect(readSessionHistory).not.toHaveBeenCalled();
      expect(harness.getLatest().model.thread.transcriptState).toMatchObject({
        kind: "runtime_waiting",
      });
      expect(harness.getLatest().model.thread.emptyState).toBe(null);
    } finally {
      await harness.unmount();
    }
  });

  test("loads existing history as an idle transcript without parent-observed pending inputs", async () => {
    const transcriptTarget = makeTranscriptTarget();
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: transcriptTarget,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor(() => readSessionHistory.mock.calls.length === 1);
      expect(readSessionHistory).toHaveBeenCalledWith({
        repoPath: "/repo-a",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a",
        externalSessionId: "session-subagent-1",
      });
      await harness.waitFor(
        (state) => state.model.thread.session?.externalSessionId === "session-subagent-1",
      );
      expect(harness.getLatest().model.thread.session?.activityState).toBe("idle");
      expect(harness.getLatest().model.thread.session?.pendingApprovals).toEqual([]);
      expect(harness.getLatest().model.thread.session?.pendingQuestions).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("prefers an already-live transcript session when it exists locally", async () => {
    const liveSession = makeLiveTranscriptSession();
    setLiveTranscriptSessions(liveSession);
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget(),
      },
      { wrapper },
    );

    try {
      await harness.mount();

      const model = harness.getLatest().model;
      expect(model.thread.session).toEqual(toAgentChatThreadSession(liveSession, []));
      expect(model.thread.transcriptState).toEqual({ kind: "visible" });
      expect(model.thread.canReplyToApprovals).toBe(true);
      expect(readSessionHistory).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("uses live subagent approvals on the transcript session", async () => {
    const pendingApproval = makePendingApproval();
    setLiveTranscriptSessions(makeLiveTranscriptSession());
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget(),
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.session?.pendingApprovals.length === 1);

      const session = harness.getLatest().model.thread.session as AgentChatThreadSession;
      expect(session.pendingApprovals).toEqual([pendingApproval]);
      expect(harness.getLatest().model.thread.canReplyToApprovals).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

  test("replies to live subagent approvals through the runtime transcript session", async () => {
    setLiveTranscriptSessions(makeLiveTranscriptSession());
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget(),
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
        makeTranscriptTarget(),
        "permission-1",
        "approve_once",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("uses and replies to live subagent questions through the runtime transcript session", async () => {
    const pendingQuestion = makePendingQuestion();
    setLiveTranscriptSessions(makeLiveTranscriptSession());
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget(),
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.canSubmitQuestionAnswers === true);

      const session = harness.getLatest().model.thread.session as AgentChatThreadSession;
      expect(session.pendingQuestions).toEqual([pendingQuestion]);
      await harness.run(async () => {
        await harness.getLatest().model.thread.onSubmitQuestionAnswers("question-1", [["A"]]);
      });

      expect(answerAgentQuestion).toHaveBeenCalledWith(makeTranscriptTarget(), "question-1", [
        ["A"],
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps question submission disabled when the live session id does not match the transcript target", async () => {
    setLiveTranscriptSessions({
      ...makeLiveTranscriptSession(),
      externalSessionId: "session-other",
    });
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget({ externalSessionId: "session-requested" }),
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
    const transcriptTarget = makeTranscriptTarget();
    readSessionHistory.mockImplementationOnce(async () => {
      throw new Error("history unavailable");
    });
    const { useSessionTranscriptSurfaceModel } = await import(
      "./use-session-transcript-surface-model"
    );
    const harness = createSharedHookHarness(
      useSessionTranscriptSurfaceModel,
      {
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: transcriptTarget,
      },
      { wrapper },
    );

    try {
      await harness.mount();
      await harness.waitFor((state) => state.model.thread.emptyState !== null);

      expect(readSessionHistory).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().model.thread.transcriptState).toEqual({
        kind: "failed",
        message: "history unavailable",
      });
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
        workspaceRepoPath: "/repo-a",
        isOpen: true,
        target: makeTranscriptTarget(),
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
