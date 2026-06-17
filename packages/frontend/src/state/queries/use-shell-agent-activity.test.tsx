import { beforeEach, describe, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import { createQueryClient } from "@/lib/query-client";
import {
  createAgentSessionFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import type {
  AgentActivitySessionsSnapshot,
  AgentSessionSummary,
  AgentSessionsStore,
  WorkflowAgentSessionSummary,
} from "@/state/agent-sessions-store";
import { AgentSessionsContext, TasksStateContext } from "@/state/app-state-contexts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TasksStateContextValue } from "@/types/state-slices";
import { useShellAgentActivity } from "./use-shell-agent-activity";

enableReactActEnvironment();

type HookArgs = {
  activeWorkspaceRepoPath: string | null;
};

const createActivitySession = (
  overrides: Partial<AgentSessionState> = {},
): WorkflowAgentSessionSummary => {
  const session = createAgentSessionFixture({
    status: "running",
    ...overrides,
  });
  if (session.role === null) {
    throw new Error("Activity session fixtures must be workflow sessions.");
  }
  return {
    externalSessionId: session.externalSessionId,
    ...(session.title ? { title: session.title } : {}),
    taskId: session.taskId,
    role: session.role,
    activityState: getAgentSessionActivityStateFromSession(session),
    startedAt: session.startedAt,
    workingDirectory: session.workingDirectory,
    selectedModel: session.selectedModel,
    runtimeKind: session.runtimeKind,
    pendingApprovalCount: session.pendingApprovals.length,
    pendingQuestionCount: session.pendingQuestions.length,
  };
};

const createActivityStore = (
  workspaceRepoPath: string | null,
  initialSessions: WorkflowAgentSessionSummary[],
): AgentSessionsStore & {
  setActivitySnapshot: (
    nextWorkspaceRepoPath: string | null,
    nextSessions: WorkflowAgentSessionSummary[],
  ) => void;
} => {
  let activitySessions = initialSessions;
  let activityWorkspaceRepoPath: string | null = workspaceRepoPath;
  let activitySnapshot: AgentActivitySessionsSnapshot = {
    workspaceRepoPath: activityWorkspaceRepoPath,
    sessions: activitySessions,
  };
  const emptySummaries: AgentSessionSummary[] = [];
  const listeners = new Set<() => void>();

  const updateSnapshot = (): void => {
    activitySnapshot = {
      workspaceRepoPath: activityWorkspaceRepoPath,
      sessions: activitySessions,
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
    getSessionSummariesSnapshot: (): AgentSessionSummary[] => emptySummaries,
    getActivitySnapshot: (): AgentActivitySessionsSnapshot => activitySnapshot,
    getSessionSnapshot: (): AgentSessionState | null => null,
    setSessionCollection: (): void => {
      throw new Error("setSessionCollection is not used in this test");
    },
    updateSession: (): AgentSessionState | null => {
      throw new Error("updateSession is not used in this test");
    },
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

let currentVisibleTasks: Array<{ id: string; title: string }> = [];

const createTasksStateValue = (): TasksStateContextValue => ({
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  tasks: currentVisibleTasks as TasksStateContextValue["tasks"],
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
  resetTaskImplementation: async () => undefined,
  resetTask: async () => undefined,
  transitionTask: async () => undefined,
  humanApproveTask: async () => undefined,
  humanRequestChangesTask: async () => undefined,
});

const createHarness = (initialProps: HookArgs, initialSessions: WorkflowAgentSessionSummary[]) => {
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
    (props: HookArgs) => useShellAgentActivity(props.activeWorkspaceRepoPath),
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
  test("shows active sessions from the current workspace session store", async () => {
    const harness = createHarness({ activeWorkspaceRepoPath: "/repo" }, [
      createActivitySession({
        externalSessionId: "session-1",
        taskId: "task-1",
        startedAt: "2026-03-17T10:00:00.000Z",
      }),
      createActivitySession({
        externalSessionId: "session-2",
        taskId: "task-2",
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
        taskId: "task-1",
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
        taskId: "task-a",
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
            taskId: "task-b",
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
