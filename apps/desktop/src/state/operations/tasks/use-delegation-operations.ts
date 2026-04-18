import type { BuildRespondInput } from "@openducktor/adapters-tauri-host";
import { useCallback } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";
import { loadRepoDefaultRuntimeKind } from "../agent-orchestrator/runtime/runtime";
import { host } from "../shared/host";
import { requireActiveRepo } from "./task-operations-model";

type UseDelegationOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
};

type UseDelegationOperationsResult = {
  delegateTask: (taskId: string) => Promise<void>;
  delegateRespond: (runId: string, input: BuildRespondInput) => Promise<void>;
  delegateStop: (runId: string) => Promise<void>;
  delegateCleanup: (runId: string, mode: "success" | "failure") => Promise<void>;
};

export function useDelegationOperations({
  activeWorkspace,
  refreshTaskData,
}: UseDelegationOperationsArgs): UseDelegationOperationsResult {
  const delegateTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repo = requireActiveRepo(activeWorkspace?.repoPath ?? null);
      const workspaceId = activeWorkspace?.workspaceId;
      if (!workspaceId) {
        throw new Error("Active workspace is required.");
      }
      const runtimeKind = await loadRepoDefaultRuntimeKind(workspaceId, "build");

      await host.buildStart(repo, taskId, runtimeKind);
      await refreshTaskData(repo);
    },
    [activeWorkspace, refreshTaskData],
  );

  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;

  const delegateRespond = useCallback(
    async (runId: string, input: BuildRespondInput) => {
      await host.buildRespond(runId, input);
      if (workspaceRepoPath) {
        await refreshTaskData(workspaceRepoPath);
      }
    },
    [workspaceRepoPath, refreshTaskData],
  );

  const delegateStop = useCallback(
    async (runId: string) => {
      await host.buildStop(runId);
      if (workspaceRepoPath) {
        await refreshTaskData(workspaceRepoPath);
      }
    },
    [workspaceRepoPath, refreshTaskData],
  );

  const delegateCleanup = useCallback(
    async (runId: string, mode: "success" | "failure") => {
      await host.buildCleanup(runId, mode);
      if (workspaceRepoPath) {
        await refreshTaskData(workspaceRepoPath);
      }
    },
    [workspaceRepoPath, refreshTaskData],
  );

  return {
    delegateTask,
    delegateRespond,
    delegateStop,
    delegateCleanup,
  };
}
