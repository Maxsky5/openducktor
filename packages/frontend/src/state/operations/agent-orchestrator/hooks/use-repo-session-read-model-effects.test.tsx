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
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { useRepoSessionReadModelEffects } from "./use-repo-session-read-model-effects";

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
  const committedLoadStates: AgentSessionReadModelLoadState[] = [];
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
    return true;
  };
  const getObservedSessionKeys = () => new Set<string>();
  const cleanupLocalSessions = mock(() => undefined);
  const commitSessionReadModelLoadState = (state: AgentSessionReadModelLoadState) => {
    committedLoadStates.push(state);
  };

  const props = (taskIds: string[]) => ({
    workspaceRepoPath: "/repo",
    taskIds,
    isLoadingTasks: false,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    commitSessionCollection,
    agentEngine,
    observeAgentSession,
    getObservedSessionKeys,
    cleanupLocalSessions,
    commitSessionReadModelLoadState,
    queryClient,
  });

  return {
    props,
    committedLoadStates,
    listSessionRuntimeSnapshots,
    observedSessions,
    cleanupLocalSessions,
  };
};

describe("useRepoSessionReadModelEffects", () => {
  test("does not reload the repo session read model when task metadata changes but task ids do not", async () => {
    const state = createHarnessState();
    const harness = createHookHarness(useRepoSessionReadModelEffects, state.props(["task-1"]));

    try {
      await harness.mount();
      await harness.waitFor(() =>
        state.committedLoadStates.some((loadState) => loadState.kind === "ready"),
      );

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
      expect(
        state.committedLoadStates.filter((loadState) => loadState.kind === "loading"),
      ).toHaveLength(1);

      await harness.update(state.props(["task-1"]));

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
      expect(
        state.committedLoadStates.filter((loadState) => loadState.kind === "loading"),
      ).toHaveLength(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload the repo session read model when task ids are reordered", async () => {
    const state = createHarnessState();
    const harness = createHookHarness(
      useRepoSessionReadModelEffects,
      state.props(["task-1", "task-2"]),
    );

    try {
      await harness.mount();
      await harness.waitFor(() =>
        state.committedLoadStates.some((loadState) => loadState.kind === "ready"),
      );

      await harness.update(state.props(["task-2", "task-1"]));

      expect(state.listSessionRuntimeSnapshots).toHaveBeenCalledTimes(1);
      expect(
        state.committedLoadStates.filter((loadState) => loadState.kind === "loading"),
      ).toHaveLength(1);
    } finally {
      await harness.unmount();
    }
  });

  test("reloads the repo session read model when the task id set changes", async () => {
    const state = createHarnessState();
    const harness = createHookHarness(useRepoSessionReadModelEffects, state.props(["task-1"]));

    try {
      await harness.mount();
      await harness.waitFor(() =>
        state.committedLoadStates.some((loadState) => loadState.kind === "ready"),
      );

      await harness.update(state.props(["task-1", "task-2"]));
      await harness.waitFor(() => state.listSessionRuntimeSnapshots.mock.calls.length === 2);

      expect(
        state.committedLoadStates.filter((loadState) => loadState.kind === "loading"),
      ).toHaveLength(2);
    } finally {
      await harness.unmount();
    }
  });
});
