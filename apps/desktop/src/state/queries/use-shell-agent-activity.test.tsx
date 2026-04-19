import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { hostClient as host } from "@/lib/host-client";
import { createQueryClient } from "@/lib/query-client";
import {
  createAgentSessionFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import {
  type AgentActivitySessionSummary,
  type AgentSessionSummary,
  type AgentSessionsById,
  type AgentSessionsStore,
  toAgentActivitySessionSummary,
} from "@/state/agent-sessions-store";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";

enableReactActEnvironment();

const actualAppStateProviderModule = await import("../app-state-provider");
const actualShellAgentActivityModule = await import("./use-shell-agent-activity");

type HookArgs = {
  activeWorkspace: ActiveWorkspace | null;
};

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: `workspace:${repoPath}`,
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const createActivitySession = (
  overrides: Partial<AgentSessionState> = {},
): AgentActivitySessionSummary =>
  toAgentActivitySessionSummary(
    createAgentSessionFixture({
      status: "running",
      ...overrides,
    }),
  );

const createActivityStore = (
  initialSessions: AgentActivitySessionSummary[],
): AgentSessionsStore & {
  setActivitySessions: (nextSessions: AgentActivitySessionSummary[]) => void;
} => {
  let activitySessions = initialSessions;
  const listeners = new Set<() => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSessionsSnapshot: (): AgentSessionState[] => [],
    getSessionSummariesSnapshot: (): AgentSessionSummary[] => [],
    getActivitySessionsSnapshot: (): AgentActivitySessionSummary[] => activitySessions,
    getSessionsByIdSnapshot: (): AgentSessionsById => ({}),
    getSessionSnapshot: (): AgentSessionState | null => null,
    setSessionsById: (): void => {
      throw new Error("setSessionsById is not used in this test");
    },
    setActivitySessions: (nextSessions) => {
      activitySessions = nextSessions;
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

let currentVisibleTasks: Array<{ id: string; title: string }> = [];
let currentActivitySessions: AgentActivitySessionSummary[] = [];
let useShellAgentActivity: typeof import("./use-shell-agent-activity").useShellAgentActivity;
const originalTasksList = host.tasksList;

const createHarness = (initialProps: HookArgs, initialSessions: AgentActivitySessionSummary[]) => {
  const queryClient = createQueryClient();
  const sessionStore = createActivityStore(initialSessions);
  currentActivitySessions = initialSessions;

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const sharedHarness = createSharedHookHarness(
    (props: HookArgs) => useShellAgentActivity(props.activeWorkspace),
    initialProps,
    { wrapper },
  );

  return {
    ...sharedHarness,
    sessionStore,
  };
};

beforeEach(async () => {
  currentVisibleTasks = [];
  currentActivitySessions = [];
  host.tasksList = async () => currentVisibleTasks as never;
  mock.module("../app-state-provider", () => ({
    ...actualAppStateProviderModule,
    useAgentActivitySessions: () => currentActivitySessions,
  }));
  ({ useShellAgentActivity } = await import("./use-shell-agent-activity"));
});

afterEach(async () => {
  host.tasksList = originalTasksList;
  currentActivitySessions = [];
  await restoreMockedModules([
    ["../app-state-provider", async () => actualAppStateProviderModule],
    ["./use-shell-agent-activity", async () => actualShellAgentActivityModule],
  ]);
});

describe("useShellAgentActivity", () => {
  test("shows only active sessions for the current repo", async () => {
    const harness = createHarness({ activeWorkspace: createActiveWorkspace("/repo") }, [
      createActivitySession({
        sessionId: "session-1",
        taskId: "task-1",
        repoPath: "/repo",
        startedAt: "2026-03-17T10:00:00.000Z",
      }),
      createActivitySession({
        sessionId: "session-2",
        taskId: "task-2",
        repoPath: "/repo",
        status: "stopped",
        startedAt: "2026-03-17T09:00:00.000Z",
      }),
      createActivitySession({
        sessionId: "session-3",
        taskId: "task-3",
        repoPath: "/other-repo",
        startedAt: "2026-03-17T08:00:00.000Z",
      }),
    ]);

    await harness.mount();

    try {
      expect(harness.getLatest()).toEqual({
        activeSessionCount: 1,
        waitingForInputCount: 0,
        activeSessions: [
          expect.objectContaining({
            sessionId: "session-1",
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
    const harness = createHarness({ activeWorkspace: createActiveWorkspace("/repo") }, [
      createActivitySession({
        sessionId: "session-1",
        taskId: "task-1",
        repoPath: "/repo",
        startedAt: "2026-03-17T10:00:00.000Z",
      }),
    ]);

    await harness.mount();

    try {
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("task-1");

      await harness.update({ activeWorkspace: null });
      expect(harness.getLatest()).toEqual({
        activeSessionCount: 0,
        waitingForInputCount: 0,
        activeSessions: [],
        waitingForInputSessions: [],
      });

      await harness.update({ activeWorkspace: createActiveWorkspace("/repo") });
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("task-1");

      await harness.run(() => {
        harness.sessionStore.setActivitySessions([]);
        currentActivitySessions = [];
      });
      await harness.update({ activeWorkspace: createActiveWorkspace("/repo") });
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
    const harness = createHarness({ activeWorkspace: createActiveWorkspace("/repo-a") }, [
      createActivitySession({
        sessionId: "session-a",
        taskId: "task-a",
        repoPath: "/repo-a",
        startedAt: "2026-03-17T10:00:00.000Z",
      }),
    ]);

    await harness.mount();

    try {
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("task-a");

      await harness.update({ activeWorkspace: createActiveWorkspace("/repo-b") });
      expect(harness.getLatest()).toEqual({
        activeSessionCount: 0,
        waitingForInputCount: 0,
        activeSessions: [],
        waitingForInputSessions: [],
      });

      await harness.run(() => {
        const nextSessions = [
          createActivitySession({
            sessionId: "session-b",
            taskId: "task-b",
            repoPath: "/repo-b",
            startedAt: "2026-03-17T11:00:00.000Z",
          }),
        ];
        harness.sessionStore.setActivitySessions(nextSessions);
        currentActivitySessions = nextSessions;
      });
      await harness.update({ activeWorkspace: createActiveWorkspace("/repo-b") });

      expect(harness.getLatest()).toEqual({
        activeSessionCount: 1,
        waitingForInputCount: 0,
        activeSessions: [
          expect.objectContaining({
            sessionId: "session-b",
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
