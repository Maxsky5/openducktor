import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
} from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { ChecksStateContext } from "@/state/app-state-contexts";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { createRepoRuntimeHealthFixture } from "@/test-utils/shared-test-fixtures";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";
import { useRepoSessionReadModel } from "./use-repo-session-read-model";

const record: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  startedAt: "2026-06-12T08:00:00.000Z",
  selectedModel: null,
};

const createHarnessState = () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-1"), [record]);
  queryClient.setQueryData(agentSessionQueryKeys.list("/repo", "task-2"), []);

  let sessionCollection: AgentSessionCollection = emptyAgentSessionCollection();
  const observedSessions: AgentSessionRef[] = [];
  const listSessionRuntimeSnapshots = mock(async () => []);
  const agentEngine = { listSessionRuntimeSnapshots };
  const currentWorkspaceRepoPathRef = { current: "/repo" };
  const repoEpochRef = { current: 0 };
  const commitSessionCollection: AgentSessionsStore["commitSessionCollection"] = (commit) => {
    const { collection, result } = commit(sessionCollection);
    sessionCollection = collection;
    return result;
  };
  const observeAgentSession = async (session: AgentSessionRef) => {
    observedSessions.push(session);
  };
  const clearSessionObservationState = mock(() => undefined);
  const readyRuntimeHealthByRuntime: RepoRuntimeHealthMap = {
    opencode: createRepoRuntimeHealthFixture(),
  };
  let runtimeHealthByRuntime = readyRuntimeHealthByRuntime;
  const props = (taskIds: string[]) => ({
    workspaceRepoPath: "/repo",
    taskIds,
    isLoadingTasks: false,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    commitSessionCollection,
    agentEngine,
    observeAgentSession,
    clearSessionObservationState,
    queryClient,
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <ChecksStateContext.Provider
      value={{
        runtimeCheck: null,
        taskStoreCheck: null,
        runtimeCheckFailureKind: null,
        taskStoreCheckFailureKind: null,
        runtimeHealthByRuntime,
        isLoadingChecks: false,
        refreshChecks: async () => undefined,
      }}
    >
      {children}
    </ChecksStateContext.Provider>
  );
  const setRuntimeHealth = (nextRuntimeHealthByRuntime = readyRuntimeHealthByRuntime) => {
    runtimeHealthByRuntime = nextRuntimeHealthByRuntime;
  };
  const createReadModelHarness = (taskIds: string[]) =>
    createHookHarness(useRepoSessionReadModel, props(taskIds), { wrapper });
  const updateReadModelHarness = (
    harness: ReturnType<typeof createReadModelHarness>,
    taskIds: string[],
  ) => harness.update(props(taskIds));

  return {
    setRuntimeHealth,
    createReadModelHarness,
    updateReadModelHarness,
    listSessionRuntimeSnapshots,
    observedSessions,
    clearSessionObservationState,
  };
};

describe("useRepoSessionReadModel", () => {
  test("does not reload the repo session read model when task metadata changes but task ids do not", async () => {
    const state = createHarnessState();
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "ready");

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);

      await state.updateReadModelHarness(harness, ["task-1"]);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload the repo session read model when task ids are reordered", async () => {
    const state = createHarnessState();
    const harness = state.createReadModelHarness(["task-1", "task-2"]);

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "ready");

      await state.updateReadModelHarness(harness, ["task-2", "task-1"]);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload the repo session read model when runtime diagnostics change but readiness does not", async () => {
    const state = createHarnessState();
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "ready");

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);

      state.setRuntimeHealth({
        opencode: createRepoRuntimeHealthFixture({
          checkedAt: "2026-06-12T08:01:00.000Z",
          mcp: { toolIds: ["odt_read_task", "odt_set_plan"] },
          runtime: { updatedAt: "2026-06-12T08:01:00.000Z" },
        }),
      });
      await state.updateReadModelHarness(harness, ["task-1"]);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload the repo session read model when an unused runtime changes readiness", async () => {
    const state = createHarnessState();
    state.setRuntimeHealth({
      opencode: createRepoRuntimeHealthFixture(),
      codex: createRepoRuntimeHealthFixture(),
    });
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "ready");

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);

      state.setRuntimeHealth({
        opencode: createRepoRuntimeHealthFixture(),
        codex: createRepoRuntimeHealthFixture(
          {},
          {
            status: "checking",
            runtime: {
              status: "checking",
              stage: "waiting_for_runtime",
            },
            mcp: {
              status: "waiting_for_runtime",
            },
          },
        ),
      });
      await state.updateReadModelHarness(harness, ["task-1"]);

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("reloads the repo session read model when the task id set changes", async () => {
    const state = createHarnessState();
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "ready");

      await state.updateReadModelHarness(harness, ["task-1", "task-2"]);
      await harness.waitFor(() => state.listSessionRuntimeSnapshots.mock.calls.length === 2);

      expect(harness.getLatest().kind).toBe("ready");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the repo session read model loading until the persisted session runtime is ready", async () => {
    const state = createHarnessState();
    const loadingRuntimeHealthByRuntime = {
      opencode: createRepoRuntimeHealthFixture(
        {},
        {
          status: "checking",
          runtime: {
            status: "checking",
            stage: "waiting_for_runtime",
          },
          mcp: {
            status: "waiting_for_runtime",
          },
        },
      ),
    };
    state.setRuntimeHealth(loadingRuntimeHealthByRuntime);
    const harness = state.createReadModelHarness(["task-1"]);

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "loading");

      expect(state.listSessionRuntimeSnapshots).not.toHaveBeenCalled();

      state.setRuntimeHealth();
      await state.updateReadModelHarness(harness, ["task-1"]);
      await harness.waitFor((loadState) => loadState.kind === "ready");

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
