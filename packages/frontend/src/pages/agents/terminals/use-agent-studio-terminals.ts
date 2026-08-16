import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { TerminalDependencies, TerminalPanelModel, TerminalScope } from "@/features/terminals";
import { useTerminals } from "@/features/terminals";
import { getShellBridge } from "@/lib/shell-bridge";
import { host } from "@/state/operations/host";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";

export type AgentStudioTerminalPanelModel = TerminalPanelModel;

type AgentStudioTerminalDependencies = {
  hostClient: TerminalDependencies["hostClient"] & Pick<typeof host, "taskWorktreeGet">;
  terminalBridge: ReturnType<typeof getShellBridge>["terminals"];
};

const defaultDependencies = (): AgentStudioTerminalDependencies => ({
  hostClient: host,
  terminalBridge: getShellBridge().terminals,
});

const legacyPreferenceKey = (repoPath: string, taskId: string): string =>
  `openducktor:agent-studio-terminals:${repoPath}:${taskId}`;

const terminalScopeKey = (workspaceId: string, taskId: string): string =>
  JSON.stringify([workspaceId, taskId]);

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
): AgentStudioTerminalPanelModel => {
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

  useEffect(() => {
    if (repoPath && taskId) localStorage.removeItem(legacyPreferenceKey(repoPath, taskId));
  }, [repoPath, taskId]);

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
