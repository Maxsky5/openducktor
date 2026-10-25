import type { TaskCard } from "@openducktor/contracts";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import { gitProviderReadError } from "@openducktor/frontend-core/review/git-provider-health";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  buildAgentStudioQuickActions,
  buildRoleEnabledMapForTask,
} from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * The desktop Agent Studio quick actions of a task. Only a task in human review offers the pull
 * request action, so only that task reads the Git provider. While the session on the screen
 * works, each action waits for it, as on desktop.
 */
export function useTaskQuickActions({
  repoPath,
  task,
  summaries,
  sessionWorking,
}: {
  repoPath: string;
  task: TaskCard | null;
  summaries: readonly AgentSessionSummary[];
  sessionWorking: boolean;
}) {
  const provider = useQuery({
    ...repositoryGitProviderContextQueryOptions(repoPath),
    enabled: task?.status === "human_review",
  });
  const providerError = gitProviderReadError(provider.error);
  const providerContext = provider.data;
  return useMemo(
    () =>
      buildAgentStudioQuickActions({
        selectedTask: task,
        sessionsForTask: summaries.filter((summary) => summary.taskId === task?.id),
        roleEnabledByTask: buildRoleEnabledMapForTask(task),
        createSessionDisabled: sessionWorking,
        gitProviderContext: providerContext,
        gitProviderReadError: providerError,
      }),
    [providerContext, providerError, sessionWorking, summaries, task],
  );
}
