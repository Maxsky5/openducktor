import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import { gitProviderReadError } from "@openducktor/frontend-core/review/git-provider-health";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  buildAgentStudioQuickActions,
  buildRoleEnabledMapForTask,
} from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { useMergedTaskTarget } from "@openducktor/frontend-core/tasks/board/use-merged-task-targets";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * The desktop Agent Studio quick actions of a task. Only a task in human review offers the pull
 * request action, so only that task reads the Git provider. A merged task branch puts Close Task first.
 */
export function useTaskQuickActions({
  workspaceId,
  repoPath,
  task,
  summaries,
}: {
  workspaceId: string;
  repoPath: string;
  task: TaskCard | null;
  summaries: readonly AgentSessionSummary[];
}) {
  const provider = useQuery({
    ...repositoryGitProviderContextQueryOptions({ workspaceId, repoPath }),
    enabled: !!task && task.taskWorkflow.pullRequestLaunchAvailable(task),
  });
  const providerError = gitProviderReadError(provider.error);
  const providerContext = provider.data;
  const mergedTarget = useMergedTaskTarget({ workspaceId, repoPath }, task);
  return useMemo(
    () =>
      buildAgentStudioQuickActions({
        selectedTask: task,
        sessionsForTask: summaries.filter((summary) => summary.taskId === task?.id),
        roleEnabledByTask: buildRoleEnabledMapForTask(task),
        gitProviderContext: providerContext,
        gitProviderReadError: providerError,
        mergedTarget,
      }),
    [mergedTarget, providerContext, providerError, summaries, task],
  );
}
