import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskWithSession } from "./agent-session-hook-test-fixtures";
import { useRepoSessionHydrationEffects } from "./use-repo-session-hydration-effects";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useRepoSessionHydrationEffects", () => {
  test("reconciles pending task sessions", async () => {
    const task = createTaskWithSession();
    const taskRecords = task.agentSessions ?? [];
    const tasks = [task];
    const loadCalls: Array<{
      taskId: string;
      mode: string | undefined;
      records: AgentSessionRecord[];
    }> = [];
    const sessionHydration = {
      bootstrapTaskSessions: async (taskId: string, records?: AgentSessionRecord[]) => {
        loadCalls.push({ taskId, mode: undefined, records: records ?? [] });
      },
      reconcileLiveTaskSessions: async ({
        taskId,
        persistedRecords,
      }: {
        taskId: string;
        persistedRecords?: AgentSessionRecord[];
      }) => {
        loadCalls.push({ taskId, mode: "reconcile_live", records: persistedRecords ?? [] });
      },
    };
    const Harness = ({ repoPath }: { repoPath: string | null }) =>
      useRepoSessionHydrationEffects({
        workspaceRepoPath: repoPath,
        tasks: repoPath ? tasks : [],
        currentWorkspaceRepoPathRef: { current: repoPath },
        sessionHydration,
        isSessionRuntimeReady: () => true,
      });
    const harness = createHookHarness<{ repoPath: string | null }, ReturnType<typeof Harness>>(
      Harness,
      { repoPath: "/tmp/repo" },
    );
    await harness.mount();
    await harness.waitFor(() =>
      loadCalls.some((call) => call.taskId === "task-1" && call.mode === "reconcile_live"),
    );

    expect(loadCalls).toEqual([
      { taskId: "task-1", mode: undefined, records: taskRecords },
      { taskId: "task-1", mode: "reconcile_live", records: taskRecords },
    ]);

    await harness.update({ repoPath: null });
    const countAfterRepoReset = loadCalls.length;
    await Promise.resolve();
    expect(loadCalls).toHaveLength(countAfterRepoReset);
    await harness.unmount();
  });

  test("bootstraps persisted sessions before runtime readiness and waits to reconcile", async () => {
    const task = createTaskWithSession();
    const taskRecords = task.agentSessions ?? [];
    const tasks = [task];
    const loadCalls: Array<{
      taskId: string;
      mode: string | undefined;
      records: AgentSessionRecord[];
    }> = [];
    const preloadCalls: Array<{ repoPath: string; records: AgentSessionRecord[] }> = [];
    const sessionHydration = {
      bootstrapTaskSessions: async (taskId: string, records?: AgentSessionRecord[]) => {
        loadCalls.push({ taskId, mode: undefined, records: records ?? [] });
      },
      reconcileLiveTaskSessions: async ({
        taskId,
        persistedRecords,
      }: {
        taskId: string;
        persistedRecords?: AgentSessionRecord[];
      }) => {
        loadCalls.push({ taskId, mode: "reconcile_live", records: persistedRecords ?? [] });
      },
    };
    const prepareRepoSessionPresencePreloads = async (input: {
      repoPath: string;
      records: AgentSessionRecord[];
    }) => {
      preloadCalls.push(input);
      return { preloadedSessionPresenceByKey: new Map() };
    };
    const Harness = ({
      repoPath,
      runtimeReady,
    }: {
      repoPath: string | null;
      runtimeReady: boolean;
    }) =>
      useRepoSessionHydrationEffects({
        workspaceRepoPath: repoPath,
        tasks: repoPath ? tasks : [],
        currentWorkspaceRepoPathRef: { current: repoPath },
        sessionHydration,
        prepareRepoSessionPresencePreloads,
        isSessionRuntimeReady: () => runtimeReady,
      });

    const harness = createHookHarness<
      { repoPath: string | null; runtimeReady: boolean },
      ReturnType<typeof Harness>
    >(Harness, { repoPath: "/tmp/repo", runtimeReady: false });
    await harness.mount();
    await harness.waitFor(() => loadCalls.length >= 1);

    expect(preloadCalls).toHaveLength(0);
    expect(loadCalls).toEqual([{ taskId: "task-1", mode: undefined, records: taskRecords }]);

    await harness.update({ repoPath: "/tmp/repo", runtimeReady: true });
    await harness.waitFor(() =>
      loadCalls.some((call) => call.taskId === "task-1" && call.mode === "reconcile_live"),
    );

    expect(preloadCalls).toEqual([{ repoPath: "/tmp/repo", records: taskRecords }]);
    expect(loadCalls).toEqual([
      { taskId: "task-1", mode: undefined, records: taskRecords },
      { taskId: "task-1", mode: "reconcile_live", records: taskRecords },
    ]);
    await harness.unmount();
  });
});
