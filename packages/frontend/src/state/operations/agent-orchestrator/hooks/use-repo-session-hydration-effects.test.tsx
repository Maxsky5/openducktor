import { describe, expect, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createTaskWithSession } from "./agent-session-hook-test-fixtures";
import { useRepoSessionHydrationEffects } from "./use-repo-session-hydration-effects";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useRepoSessionHydrationEffects", () => {
  test("reconciles pending task sessions", async () => {
    const loadCalls: Array<{ taskId: string; mode: string | undefined }> = [];
    const Harness = ({ repoPath }: { repoPath: string | null }) =>
      useRepoSessionHydrationEffects({
        workspaceRepoPath: repoPath,
        tasks: repoPath ? [createTaskWithSession()] : [],
        currentWorkspaceRepoPathRef: { current: repoPath },
        sessionHydration: {
          bootstrapTaskSessions: async (taskId) => {
            loadCalls.push({ taskId, mode: undefined });
          },
          reconcileLiveTaskSessions: async ({ taskId }) => {
            loadCalls.push({ taskId, mode: "reconcile_live" });
          },
        },
        isSessionRuntimeReady: () => true,
      });
    const harness = createHookHarness<{ repoPath: string | null }, ReturnType<typeof Harness>>(
      Harness,
      { repoPath: "/tmp/repo" },
    );
    await harness.mount();
    await harness.waitFor(() => loadCalls.length >= 1);

    expect(loadCalls).toContainEqual({ taskId: "task-1", mode: "reconcile_live" });

    await harness.update({ repoPath: null });
    const countAfterRepoReset = loadCalls.length;
    await Promise.resolve();
    expect(loadCalls).toHaveLength(countAfterRepoReset);
    await harness.unmount();
  });

  test("waits for persisted session runtime readiness before reconciling", async () => {
    const loadCalls: Array<{ taskId: string; mode: string | undefined }> = [];
    const preloadCalls: unknown[] = [];
    const Harness = ({
      repoPath,
      runtimeReady,
    }: {
      repoPath: string | null;
      runtimeReady: boolean;
    }) =>
      useRepoSessionHydrationEffects({
        workspaceRepoPath: repoPath,
        tasks: repoPath ? [createTaskWithSession()] : [],
        currentWorkspaceRepoPathRef: { current: repoPath },
        sessionHydration: {
          bootstrapTaskSessions: async (taskId) => {
            loadCalls.push({ taskId, mode: undefined });
          },
          reconcileLiveTaskSessions: async ({ taskId }) => {
            loadCalls.push({ taskId, mode: "reconcile_live" });
          },
        },
        prepareRepoSessionPresencePreloads: async (input) => {
          preloadCalls.push(input);
          return { preloadedSessionPresenceByKey: new Map() };
        },
        isSessionRuntimeReady: () => runtimeReady,
      });

    const harness = createHookHarness<
      { repoPath: string | null; runtimeReady: boolean },
      ReturnType<typeof Harness>
    >(Harness, { repoPath: "/tmp/repo", runtimeReady: false });
    await harness.mount();

    expect(preloadCalls).toHaveLength(0);
    expect(loadCalls).toHaveLength(0);

    await harness.update({ repoPath: "/tmp/repo", runtimeReady: true });
    await harness.waitFor(() => loadCalls.length >= 1);

    expect(preloadCalls).toHaveLength(1);
    expect(loadCalls).toContainEqual({ taskId: "task-1", mode: "reconcile_live" });
    await harness.unmount();
  });
});
