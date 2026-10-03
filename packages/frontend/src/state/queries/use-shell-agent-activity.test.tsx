import { beforeEach, describe, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { createQueryClient } from "@/lib/query-client";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createAgentSessionFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { EMPTY_AGENT_SESSION_VISIBLE_PENDING_INPUT } from "@/state/agent-session-visible-pending-input";
import type {
  AgentActivitySessionsSnapshot,
  AgentSessionSummary,
  AgentSessionsStore,
} from "@/state/agent-sessions-store";
import { AgentSessionsContext, TasksStateContext } from "@/state/app-state-contexts";
import { isWorkflowAgentSession } from "@/state/operations/agent-orchestrator/support/workflow-session";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionFixtureOverrides } from "@/test-utils/shared-test-fixtures";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TasksStateContextValue } from "@/types/state-slices";
import { useShellAgentActivity } from "./use-shell-agent-activity";

enableReactActEnvironment();

type HookArgs = {
  activeWorkspaceRepoPath: string | null;
};

const createActivitySession = (
  overrides: AgentSessionFixtureOverrides = {},
): AgentSessionSummary => {
  const session = createAgentSessionFixture({
    status: "running",
    ...overrides,
  });
  if (!isWorkflowAgentSession(session)) {
    throw new Error("Activity session fixtures must be workflow sessions.");
  }
  const activitySession: AgentSessionSummary = {
    externalSessionId: session.externalSessionId,
    taskId: session.sessionAssociation.taskId,
    role: session.sessionAssociation.role,
    activityState: getAgentSessionActivityStateFromSession(session),
    startedAt: session.startedAt,
    workingDirectory: session.workingDirectory,
    selectedModel: session.selectedModel,
    runtimeKind: session.runtimeKind,
    pendingApprovalCount: session.pendingApprovals.length,
    pendingQuestionCount: session.pendingQuestions.length,
  };
  if (session.title) {
    activitySession.title = session.title;
  }
  return activitySession;
};

const createActivityStore = (
  workspaceRepoPath: string | null,
  initialSessions: AgentSessionSummary[],
): AgentSessionsStore & {
  setActivitySnapshot: (
    nextWorkspaceRepoPath: string | null,
    nextSessions: AgentSessionSummary[],
  ) => void;
} => {
  let activitySessions = initialSessions;
  let activityWorkspaceRepoPath: string | null = workspaceRepoPath;
  let activitySnapshot: AgentActivitySessionsSnapshot = {
    workspaceRepoPath: activityWorkspaceRepoPath,
    sessions: activitySessions,
    repositorySessions: [],
  };
  const listeners = new Set<() => void>();

  const updateSnapshot = (): void => {
    activitySnapshot = {
      workspaceRepoPath: activityWorkspaceRepoPath,
      sessions: activitySessions,
      repositorySessions: [],
    };
  };

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getActivitySnapshot: (): AgentActivitySessionsSnapshot => activitySnapshot,
    getSessionSnapshot: (): AgentSessionState | null => null,
    listSessionSnapshots: (): AgentSessionState[] => [],
    getVisiblePendingInputSnapshot: () => EMPTY_AGENT_SESSION_VISIBLE_PENDING_INPUT,
    commitSessionCollection: () => {
      throw new Error("commitSessionCollection is not used in this test");
    },
    setSessionCollection: (): void => {
      throw new Error("setSessionCollection is not used in this test");
    },
    replaceSession: (): void => {
      throw new Error("replaceSession is not used in this test");
    },
    removeSession: (): void => {
      throw new Error("removeSession is not used in this test");
    },
    updateSession: (): AgentSessionState | null => {
      throw new Error("updateSession is not used in this test");
    },
    invalidateRetainedHistory: () => {},
    resetWorkspace: (workspaceRepoPath): void => {
      activityWorkspaceRepoPath = workspaceRepoPath;
      activitySessions = [];
      updateSnapshot();
      notify();
    },
    setActivitySnapshot: (nextWorkspaceRepoPath, nextSessions) => {
      activityWorkspaceRepoPath = nextWorkspaceRepoPath;
      activitySessions = nextSessions;
      updateSnapshot();
      notify();
    },
  };
};

let currentVisibleTasks: TasksStateContextValue["tasks"] = [];

const createTasksStateValue = (): TasksStateContextValue => ({
  tasksAreCurrent: true,
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  tasks: currentVisibleTasks,
  isLoadingTasks: false,
  createTask: async () => undefined,
  updateTask: async () => undefined,
  setTaskTargetBranch: async () => undefined,
  refreshTasks: async () => undefined,
  syncPullRequests: async () => undefined,
  linkMergedPullRequest: async () => undefined,
  cancelLinkMergedPullRequest: () => undefined,
  unlinkPullRequest: async () => undefined,
  detectingPullRequestTaskId: null,
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskId: null,
  pendingMergedPullRequest: null,
  deleteTask: async () => undefined,
  closeTask: async () => undefined,
  resetTaskImplementation: async () => undefined,
  resetTask: async () => undefined,
  transitionTask: async () => undefined,
  humanApproveTask: async () => undefined,
  humanRequestChangesTask: async () => undefined,
});

const createHarness = (initialProps: HookArgs, initialSessions: AgentSessionSummary[]) => {
  const queryClient = createQueryClient();
  const sessionStore = createActivityStore(initialProps.activeWorkspaceRepoPath, initialSessions);

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <TasksStateContext.Provider value={createTasksStateValue()}>
        <AgentSessionsContext.Provider value={sessionStore}>
          {children}
        </AgentSessionsContext.Provider>
      </TasksStateContext.Provider>
    </QueryClientProvider>
  );

  const sharedHarness = createSharedHookHarness(
    (props: HookArgs) => useShellAgentActivity(props.activeWorkspaceRepoPath, null),
    initialProps,
    { wrapper },
  );

  return {
    ...sharedHarness,
    sessionStore,
  };
};

beforeEach(() => {
  currentVisibleTasks = [];
});

describe("useShellAgentActivity", () => {
  test.each(["opencode", "codex"] as const)(
    "joins %s chats and follows repeated input requests without a reload",
    async (runtimeKind) => {
      const store = createAgentSessionsStore("/repo");
      const chat = createAgentSessionFixture({
        runtimeKind,
        workingDirectory: "/repo",
        externalSessionId: "native-chat",
        sessionAssociation: { kind: "repository" },
        status: "running",
      });
      store.replaceSession(chat);
      const client = createQueryClient();
      configureShellBridge(
        createShellBridgeFixture({
          client: {
            workspaceSessionListActive: async (workspaceId) =>
              workspaceId === "A"
                ? [
                    {
                      id: "chat",
                      externalSessionId: "native-chat",
                      runtimeKind,
                      executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
                      roleSnapshot: null,
                      selectedModel: null,
                      manualTitle: "Plan release",
                      generatedTitle: null,
                      createdAt: 1,
                      updatedAt: 1,
                      archivedAt: null,
                    },
                  ]
                : [],
          },
        }),
      );
      const wrapper = ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>
          <TasksStateContext value={createTasksStateValue()}>
            <AgentSessionsContext value={store}>{children}</AgentSessionsContext>
          </TasksStateContext>
        </QueryClientProvider>
      );
      const harness = createSharedHookHarness(
        (props: { path: string; id: string }) => useShellAgentActivity(props.path, props.id),
        { path: "/repo", id: "A" },
        { wrapper },
      );
      try {
        await harness.mount();
        await harness.waitFor((value) => value.activeSessionCount === 1, 800);
        expect(harness.getLatest().activeSessions[0]).toMatchObject({
          workspaceSessionId: "chat",
          taskTitle: "Plan release",
        });
        await harness.run(() => {
          store.updateSession(chat, (current) => ({
            ...current,
            pendingQuestions: [{ requestId: "q1", questions: [] }],
          }));
        });
        expect(harness.getLatest().activeSessionCount).toBe(0);
        expect(harness.getLatest().waitingForInputCount).toBe(1);
        await harness.run(() => {
          store.updateSession(chat, (current) => ({ ...current, pendingQuestions: [] }));
        });
        expect(harness.getLatest().waitingForInputCount).toBe(0);
        expect(harness.getLatest().activeSessionCount).toBe(1);
        await harness.run(() => {
          store.updateSession(chat, (current) => ({
            ...current,
            pendingQuestions: [{ requestId: "q2", questions: [] }],
          }));
        });
        expect(harness.getLatest().waitingForInputCount).toBe(1);
        expect(harness.getLatest().waitingForInputSessions[0]?.workspaceSessionId).toBe("chat");
        await harness.update({ path: "/other", id: "B" });
        expect(harness.getLatest().waitingForInputCount).toBe(0);
        expect(harness.getLatest().activeSessionCount).toBe(0);
      } finally {
        await harness.unmount();
        client.clear();
        configureShellBridge(createUnavailableShellBridge());
      }
    },
  );
  test("shows active sessions from the current workspace session store", async () => {
    const harness = createHarness({ activeWorkspaceRepoPath: "/repo" }, [
      createActivitySession({
        externalSessionId: "session-1",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        startedAt: "2026-03-17T10:00:00.000Z",
      }),
      createActivitySession({
        externalSessionId: "session-2",
        sessionAssociation: { kind: "workflow", taskId: "task-2", role: "spec" },
        status: "stopped",
        startedAt: "2026-03-17T09:00:00.000Z",
      }),
    ]);

    await harness.mount();

    try {
      expect(harness.getLatest()).toEqual({
        activeSessionCount: 1,
        waitingForInputCount: 0,
        activeSessions: [
          expect.objectContaining({
            externalSessionId: "session-1",
            taskId: "task-1",
            taskTitle: "task-1",
          }),
        ],
        waitingForInputSessions: [],
      });
    } finally {
      await harness.unmount();
    }
  });

  test("updates when the workspace clears and when active sessions change", async () => {
    const harness = createHarness({ activeWorkspaceRepoPath: "/repo" }, [
      createActivitySession({
        externalSessionId: "session-1",
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
        startedAt: "2026-03-17T10:00:00.000Z",
      }),
    ]);

    await harness.mount();

    try {
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("task-1");

      await harness.update({ activeWorkspaceRepoPath: null });
      expect(harness.getLatest()).toEqual({
        activeSessionCount: 0,
        waitingForInputCount: 0,
        activeSessions: [],
        waitingForInputSessions: [],
      });

      await harness.update({ activeWorkspaceRepoPath: "/repo" });
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("task-1");

      await harness.run(() => {
        harness.sessionStore.setActivitySnapshot("/repo", []);
      });
      await harness.update({ activeWorkspaceRepoPath: "/repo" });
      expect(harness.getLatest()).toEqual({
        activeSessionCount: 0,
        waitingForInputCount: 0,
        activeSessions: [],
        waitingForInputSessions: [],
      });
    } finally {
      await harness.unmount();
    }
  });

  test("does not expose previous repo activity during a direct repo-to-repo switch", async () => {
    const harness = createHarness({ activeWorkspaceRepoPath: "/repo-a" }, [
      createActivitySession({
        externalSessionId: "session-a",
        sessionAssociation: { kind: "workflow", taskId: "task-a", role: "spec" },
        startedAt: "2026-03-17T10:00:00.000Z",
      }),
    ]);

    await harness.mount();

    try {
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("task-a");

      await harness.update({ activeWorkspaceRepoPath: "/repo-b" });
      await harness.run(() => {
        harness.sessionStore.setActivitySnapshot("/repo-b", []);
      });
      expect(harness.getLatest()).toEqual({
        activeSessionCount: 0,
        waitingForInputCount: 0,
        activeSessions: [],
        waitingForInputSessions: [],
      });

      await harness.run(() => {
        const nextSessions = [
          createActivitySession({
            externalSessionId: "session-b",
            sessionAssociation: { kind: "workflow", taskId: "task-b", role: "spec" },
            startedAt: "2026-03-17T11:00:00.000Z",
          }),
        ];
        harness.sessionStore.setActivitySnapshot("/repo-b", nextSessions);
      });
      await harness.update({ activeWorkspaceRepoPath: "/repo-b" });

      expect(harness.getLatest()).toEqual({
        activeSessionCount: 1,
        waitingForInputCount: 0,
        activeSessions: [
          expect.objectContaining({
            externalSessionId: "session-b",
            taskId: "task-b",
            taskTitle: "task-b",
          }),
        ],
        waitingForInputSessions: [],
      });
    } finally {
      await harness.unmount();
    }
  });
});
