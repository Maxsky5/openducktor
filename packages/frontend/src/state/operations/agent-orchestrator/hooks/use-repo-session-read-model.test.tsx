import { describe, expect, mock, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { QueryClient } from "@tanstack/react-query";
import {
  type AgentSessionCollection,
  emptyAgentSessionCollection,
} from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
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
  const props = (
    taskIds: string[],
    runtimeHealthByRuntime: RepoRuntimeHealthMap = readyRuntimeHealthByRuntime,
  ) => ({
    workspaceRepoPath: "/repo",
    taskIds,
    isLoadingTasks: false,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    commitSessionCollection,
    agentEngine,
    observeAgentSession,
    clearSessionObservationState,
    runtimeHealthByRuntime,
    queryClient,
  });

  return {
    props,
    listSessionRuntimeSnapshots,
    observedSessions,
    clearSessionObservationState,
  };
};

describe("useRepoSessionReadModel", () => {
  test("does not reload the repo session read model when task metadata changes but task ids do not", async () => {
    const state = createHarnessState();
    const harness = createHookHarness(useRepoSessionReadModel, state.props(["task-1"]));

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "ready");

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);

      await harness.update(state.props(["task-1"]));

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload the repo session read model when task ids are reordered", async () => {
    const state = createHarnessState();
    const harness = createHookHarness(useRepoSessionReadModel, state.props(["task-1", "task-2"]));

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "ready");

      await harness.update(state.props(["task-2", "task-1"]));

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("reloads the repo session read model when the task id set changes", async () => {
    const state = createHarnessState();
    const harness = createHookHarness(useRepoSessionReadModel, state.props(["task-1"]));

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "ready");

      await harness.update(state.props(["task-1", "task-2"]));
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
    const harness = createHookHarness(
      useRepoSessionReadModel,
      state.props(["task-1"], loadingRuntimeHealthByRuntime),
    );

    try {
      await harness.mount();
      await harness.waitFor((loadState) => loadState.kind === "loading");

      expect(state.listSessionRuntimeSnapshots).not.toHaveBeenCalled();

      await harness.update(state.props(["task-1"]));
      await harness.waitFor((loadState) => loadState.kind === "ready");

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });
});
