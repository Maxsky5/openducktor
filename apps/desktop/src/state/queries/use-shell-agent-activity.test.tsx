import { describe, expect, test } from "bun:test";
import type { RunSummary } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { createQueryClient } from "@/lib/query-client";
import {
  createAgentSessionFixture,
  createTaskCardFixture,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { AgentSessionsContext } from "@/state/app-state-contexts";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { ActiveWorkspace } from "@/types/state-slices";
import { taskQueryKeys } from "./tasks";
import { useShellAgentActivity } from "./use-shell-agent-activity";

enableReactActEnvironment();

type HookArgs = {
  activeWorkspace: ActiveWorkspace | null;
};

const createActiveWorkspace = (repoPath: string): ActiveWorkspace => ({
  workspaceId: `workspace:${repoPath}`,
  workspaceName: repoPath.split("/").filter(Boolean).at(-1) ?? "repo",
  repoPath,
});

const createRun = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  runId: "run-1",
  runtimeKind: "opencode",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4000",
  },
  repoPath: "/repo",
  taskId: "task-1",
  branch: "main",
  worktreePath: "/tmp/worktree",
  port: 4000,
  state: "running",
  lastMessage: null,
  startedAt: "2026-03-17T10:00:00.000Z",
  ...overrides,
});

const createHarness = (initialProps: HookArgs) => {
  const sessionStore = createAgentSessionsStore();
  const queryClient = createQueryClient();
  let renderCount = 0;

  const wrapper = ({ children }: PropsWithChildren): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <AgentSessionsContext.Provider value={sessionStore}>{children}</AgentSessionsContext.Provider>
    </QueryClientProvider>
  );

  const sharedHarness = createSharedHookHarness(
    (props: HookArgs) => {
      renderCount += 1;
      return useShellAgentActivity(props.activeWorkspace);
    },
    initialProps,
    { wrapper },
  );

  return {
    queryClient,
    sessionStore,
    mount: sharedHarness.mount,
    update: sharedHarness.update,
    run: sharedHarness.run,
    waitFor: sharedHarness.waitFor,
    getLatest: sharedHarness.getLatest,
    unmount: sharedHarness.unmount,
    getRenderCount: () => renderCount,
  };
};

const waitForActivity = async (
  harness: ReturnType<typeof createHarness>,
  predicate: (activity: ReturnType<typeof useShellAgentActivity>) => boolean,
): Promise<void> => {
  await harness.waitFor((activity) => predicate(activity), 400);
};

describe("useShellAgentActivity", () => {
  test("does not rerender for runs-only, unrelated task-title, or non-activity session churn", async () => {
    const harness = createHarness({ activeWorkspace: createActiveWorkspace("/repo") });
    const session = createAgentSessionFixture({
      sessionId: "session-1",
      taskId: "task-1",
      repoPath: "/repo",
      status: "running",
      startedAt: "2026-03-17T10:00:00.000Z",
    });

    harness.sessionStore.setSessionsById({ [session.sessionId]: session });
    harness.queryClient.setQueryData(taskQueryKeys.visibleTasks("/repo"), [
      createTaskCardFixture({ id: "task-1", title: "Visible Task" }),
      createTaskCardFixture({ id: "task-2", title: "Other Task" }),
    ]);
    await harness.mount();

    try {
      await waitForActivity(
        harness,
        (activity) => activity.activeSessions[0]?.taskTitle === "Visible Task",
      );
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("Visible Task");

      const baselineActivity = harness.getLatest();
      const baselineRenderCount = harness.getRenderCount();

      await harness.run(() => {
        harness.queryClient.setQueryData(taskQueryKeys.repoData("/repo"), {
          tasks: [
            createTaskCardFixture({ id: "task-1", title: "Visible Task" }),
            createTaskCardFixture({ id: "task-2", title: "Other Task" }),
          ],
          runs: [createRun()],
        });
      });

      expect(harness.getLatest()).toBe(baselineActivity);
      expect(harness.getRenderCount()).toBe(baselineRenderCount);

      await harness.run(() => {
        harness.queryClient.setQueryData(taskQueryKeys.visibleTasks("/repo"), [
          createTaskCardFixture({ id: "task-1", title: "Visible Task" }),
          createTaskCardFixture({ id: "task-2", title: "Renamed Other Task" }),
        ]);
      });

      expect(harness.getLatest()).toBe(baselineActivity);
      expect(harness.getRenderCount()).toBe(baselineRenderCount);

      await harness.run(() => {
        harness.sessionStore.setSessionsById({
          [session.sessionId]: {
            ...session,
            messages: [
              { id: "m-1", role: "assistant", content: "still working", timestamp: "now" },
            ],
            draftAssistantText: "draft update",
            todos: [
              { id: "todo-1", content: "Review diff", status: "pending", priority: "medium" },
            ],
          },
        });
      });

      expect(harness.getLatest()).toBe(baselineActivity);
      expect(harness.getRenderCount()).toBe(baselineRenderCount);
    } finally {
      await harness.unmount();
    }
  });

  test("updates for visible task-title changes, repo clearing, and session removal", async () => {
    const harness = createHarness({ activeWorkspace: createActiveWorkspace("/repo") });
    const session = createAgentSessionFixture({
      sessionId: "session-1",
      taskId: "task-1",
      repoPath: "/repo",
      status: "running",
      startedAt: "2026-03-17T10:00:00.000Z",
    });

    harness.sessionStore.setSessionsById({ [session.sessionId]: session });
    harness.queryClient.setQueryData(taskQueryKeys.visibleTasks("/repo"), [
      createTaskCardFixture({ id: "task-1", title: "Initial Title" }),
    ]);
    await harness.mount();

    try {
      await waitForActivity(
        harness,
        (activity) => activity.activeSessions[0]?.taskTitle === "Initial Title",
      );
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("Initial Title");

      const initialRenderCount = harness.getRenderCount();

      await harness.run(() => {
        harness.queryClient.setQueryData(taskQueryKeys.visibleTasks("/repo"), [
          createTaskCardFixture({ id: "task-1", title: "Updated Title" }),
        ]);
      });

      await waitForActivity(
        harness,
        (activity) => activity.activeSessions[0]?.taskTitle === "Updated Title",
      );
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("Updated Title");
      expect(harness.getRenderCount()).toBeGreaterThan(initialRenderCount);

      await harness.update({ activeWorkspace: null });
      expect(harness.getLatest().activeSessionCount).toBe(0);
      expect(harness.getLatest().waitingForInputCount).toBe(0);

      await harness.update({ activeWorkspace: createActiveWorkspace("/repo") });
      await waitForActivity(
        harness,
        (activity) => activity.activeSessions[0]?.taskTitle === "Updated Title",
      );
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("Updated Title");

      await harness.run(() => {
        harness.sessionStore.setSessionsById({});
      });

      expect(harness.getLatest().activeSessionCount).toBe(0);
      expect(harness.getLatest().activeSessions).toHaveLength(0);
    } finally {
      await harness.unmount();
    }
  });

  test("does not expose previous repo activity during a direct repo-to-repo switch", async () => {
    const harness = createHarness({ activeWorkspace: createActiveWorkspace("/repo-a") });
    const repoASession = createAgentSessionFixture({
      sessionId: "session-a",
      taskId: "task-a",
      repoPath: "/repo-a",
      status: "running",
      startedAt: "2026-03-17T10:00:00.000Z",
    });
    const repoBSession = createAgentSessionFixture({
      sessionId: "session-b",
      taskId: "task-b",
      repoPath: "/repo-b",
      status: "running",
      startedAt: "2026-03-17T11:00:00.000Z",
    });

    harness.sessionStore.setSessionsById({ [repoASession.sessionId]: repoASession });
    harness.queryClient.setQueryData(taskQueryKeys.visibleTasks("/repo-a"), [
      createTaskCardFixture({ id: "task-a", title: "Repo A Task" }),
    ]);
    harness.queryClient.setQueryData(taskQueryKeys.visibleTasks("/repo-b"), [
      createTaskCardFixture({ id: "task-b", title: "Repo B Task" }),
    ]);
    await harness.mount();

    try {
      await waitForActivity(
        harness,
        (activity) => activity.activeSessions[0]?.taskTitle === "Repo A Task",
      );
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("Repo A Task");

      await harness.update({ activeWorkspace: createActiveWorkspace("/repo-b") });

      expect(harness.getLatest().activeSessionCount).toBe(0);
      expect(harness.getLatest().waitingForInputCount).toBe(0);
      expect(harness.getLatest().activeSessions).toHaveLength(0);

      await harness.run(() => {
        harness.sessionStore.setSessionsById({ [repoBSession.sessionId]: repoBSession });
      });

      await waitForActivity(
        harness,
        (activity) => activity.activeSessions[0]?.taskTitle === "Repo B Task",
      );
      expect(harness.getLatest().activeSessions[0]?.taskTitle).toBe("Repo B Task");
      expect(harness.getLatest().activeSessions[0]).toMatchObject({
        sessionId: "session-b",
        taskTitle: "Repo B Task",
      });
    } finally {
      await harness.unmount();
    }
  });
});
