import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useMemo } from "react";
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

export const useAgentStudioTerminals = (
  {
    repoPath,
    taskId,
    taskVersion,
  }: {
    repoPath: string | null;
    taskId: string | null;
    taskVersion?: string | null;
  },
  dependencies = defaultDependencies(),
): AgentStudioTerminalPanelModel => {
  const enabled = repoPath !== null && taskId !== null;
  const worktreeOptions = enabled
    ? taskWorktreeQueryOptions({
        repoPath,
        taskId,
        hostClient: dependencies.hostClient,
        ...(taskVersion !== undefined ? { taskVersion } : {}),
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

  useLayoutEffect(() => {
    if (repoPath && taskId) localStorage.removeItem(legacyPreferenceKey(repoPath, taskId));
  }, [repoPath, taskId]);

  const scope = useMemo((): TerminalScope | null => {
    if (!repoPath || !taskId) return null;
    return {
      key: `${repoPath}:${taskId}`,
      context: { repoPath, taskId },
      workingDirectory: worktreeQuery.data?.workingDirectory ?? null,
      workingDirectoryError: `Task ${taskId} has no available worktree.`,
    };
  }, [repoPath, taskId, worktreeQuery.data?.workingDirectory]);
  const terminalModel = useTerminals(
    { scope, isScopeLoading: worktreeQuery.isLoading },
    dependencies,
  );

  return terminalModel;
};
