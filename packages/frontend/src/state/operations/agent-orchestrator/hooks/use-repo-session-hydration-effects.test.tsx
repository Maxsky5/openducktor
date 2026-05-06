import { describe, expect, test } from "bun:test";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { AgentSessionPresenceStore } from "../lifecycle/session-presence-store";
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
        agentSessionPresenceStore: new AgentSessionPresenceStore(),
        sessionHydration: {
          bootstrapTaskSessions: async (taskId) => {
            loadCalls.push({ taskId, mode: undefined });
          },
          reconcileLiveTaskSessions: async ({ taskId }) => {
            loadCalls.push({ taskId, mode: "reconcile_live" });
          },
        },
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
});
