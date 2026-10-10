import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { sessionPanelOwnerKey } from "@/features/session-panels";
import type {
  TerminalDependencies,
  TerminalScope,
  TerminalSessionsModel,
} from "@/features/terminals";
import { useTerminals } from "@/features/terminals";
import { getShellBridge } from "@/lib/shell-bridge";
import { host } from "@/state/operations/host";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";

type AgentStudioTerminalDependencies = {
  hostClient: TerminalDependencies["hostClient"] & Pick<typeof host, "taskWorktreeGet">;
  terminalBridge: ReturnType<typeof getShellBridge>["terminals"];
};

const defaultDependencies = (): AgentStudioTerminalDependencies => ({
  hostClient: host,
  terminalBridge: getShellBridge().terminals,
});

/** The panel layout owner key, so the panels can place the terminals of each task. */
const terminalScopeKey = (workspaceId: string, taskId: string): string =>
  sessionPanelOwnerKey({ kind: "task", workspaceId, taskId });

export const useAgentStudioTerminals = (
  {
    workspaceId,
    repoPath,
    taskId,
    taskVersion,
    mountedTaskIds,
  }: {
    workspaceId: string | null;
    repoPath: string | null;
    taskId: string | null;
    taskVersion: string | null;
    mountedTaskIds: readonly string[];
  },
  dependencies = defaultDependencies(),
): TerminalSessionsModel => {
  const enabled = workspaceId !== null && repoPath !== null && taskId !== null;
  const worktreeOptions = enabled
    ? taskWorktreeQueryOptions({
        repoPath,
        taskId,
        hostClient: dependencies.hostClient,
        taskVersion,
      })
    : taskWorktreeQueryOptions({
        repoPath: "disabled",
        taskId: "disabled",
        hostClient: dependencies.hostClient,
      });
  const worktreeQuery = useQuery({
    ...worktreeOptions,
    enabled,
  });

  const mountedScopeKeys = useMemo(() => {
    if (!workspaceId) return [];
    return mountedTaskIds.map((mountedTaskId) => terminalScopeKey(workspaceId, mountedTaskId));
  }, [mountedTaskIds, workspaceId]);

  const scope = useMemo((): TerminalScope | null => {
    if (!workspaceId || !repoPath || !taskId) return null;
    return {
      key: terminalScopeKey(workspaceId, taskId),
      context: { repoPath, taskId },
      workingDirectory: worktreeQuery.data?.workingDirectory ?? null,
      workingDirectoryError: `Task ${taskId} has no available worktree.`,
    };
  }, [repoPath, taskId, workspaceId, worktreeQuery.data?.workingDirectory]);
  const terminalModel = useTerminals(
    { scope, isScopeLoading: worktreeQuery.isLoading, mountedScopeKeys },
    dependencies,
  );

  return terminalModel;
};
