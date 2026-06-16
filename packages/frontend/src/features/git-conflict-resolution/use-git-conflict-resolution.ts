import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import type { GitConflict } from "@/features/agent-studio-git";
import {
  buildGitConflictResolutionPrompt,
  buildReusableSessionOptions,
} from "@/features/session-start";
import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { getGitConflictCopy } from "./conflict-copy";
import { BUILD_REBASE_CONFLICT_RESOLUTION_LAUNCH_ACTION } from "./constants";

export type StartGitConflictResolutionSessionInput = {
  taskId: string;
  role: "build";
  launchActionId: "build_rebase_conflict_resolution";
  message: string;
  existingSessionOptions: ReturnType<typeof buildReusableSessionOptions>;
  initialStartMode: "fresh" | "reuse";
  initialSourceSession: AgentSessionIdentity | null;
  targetWorkingDirectory: string;
};

type GitConflictTaskContext = {
  taskId: string;
  task: TaskCard | null;
  builderSessions: AgentSessionSummary[];
  currentViewSession: AgentSessionIdentity | null;
  onOpenSession: (session: AgentSessionIdentity) => void;
};

type UseGitConflictResolutionArgs = {
  workspaceId: string | null;
  startConflictResolutionSession: (
    input: StartGitConflictResolutionSessionInput,
  ) => Promise<AgentSessionIdentity | undefined>;
  loadPromptOverrides?: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type UseGitConflictResolutionResult = {
  handleResolveGitConflict: (
    conflict: GitConflict,
    taskContext: GitConflictTaskContext,
  ) => Promise<boolean>;
};

const filterConflictBuilderSessions = (
  conflict: GitConflict,
  builderSessions: AgentSessionSummary[],
): AgentSessionSummary[] => {
  const conflictWorkingDirectory = normalizeWorkingDirectory(conflict.workingDir);

  return builderSessions.filter(
    (session) => normalizeWorkingDirectory(session.workingDirectory) === conflictWorkingDirectory,
  );
};

const pickDefaultBuilderSession = ({
  builderSessions,
  currentViewSession,
}: {
  builderSessions: AgentSessionSummary[];
  currentViewSession: AgentSessionIdentity | null;
}): AgentSessionSummary | null => {
  return (
    builderSessions.find((session) => matchesAgentSessionIdentity(session, currentViewSession)) ??
    builderSessions[0] ??
    null
  );
};

export function useGitConflictResolution({
  workspaceId,
  startConflictResolutionSession,
  loadPromptOverrides = loadEffectivePromptOverrides,
}: UseGitConflictResolutionArgs): UseGitConflictResolutionResult {
  const handleResolveGitConflict = useCallback(
    async (conflict: GitConflict, taskContext: GitConflictTaskContext): Promise<boolean> => {
      if (!workspaceId) {
        throw new Error("Cannot resolve a git conflict because no repository is selected.");
      }

      const conflictWorkingDirectory = normalizeWorkingDirectory(conflict.workingDir);
      if (!conflictWorkingDirectory) {
        throw new Error(
          `Cannot resolve a git conflict for task "${taskContext.taskId}" because the conflicted working directory is missing.`,
        );
      }

      const validBuilderSessions = filterConflictBuilderSessions(
        conflict,
        taskContext.builderSessions,
      );
      const defaultBuilderSession = pickDefaultBuilderSession({
        builderSessions: validBuilderSessions,
        currentViewSession: taskContext.currentViewSession,
      });

      const promptOverrides = await loadPromptOverrides(workspaceId);
      const message = buildGitConflictResolutionPrompt(taskContext.taskId, {
        overrides: promptOverrides,
        ...(taskContext.task
          ? {
              task: {
                title: taskContext.task.title,
                issueType: taskContext.task.issueType,
                status: taskContext.task.status,
                qaRequired: taskContext.task.aiReviewEnabled,
                description: taskContext.task.description,
              },
            }
          : {}),
        git: {
          operationLabel: getGitConflictCopy(conflict.operation).operationLabel,
          ...(conflict.currentBranch ? { currentBranch: conflict.currentBranch } : {}),
          targetBranch: conflict.targetBranch,
          conflictedFiles: conflict.conflictedFiles,
          conflictOutput: conflict.output,
        },
      });

      const session = await startConflictResolutionSession({
        taskId: taskContext.taskId,
        role: "build",
        launchActionId: BUILD_REBASE_CONFLICT_RESOLUTION_LAUNCH_ACTION,
        message,
        existingSessionOptions: buildReusableSessionOptions({
          sessions: validBuilderSessions,
          role: "build",
        }),
        initialStartMode: defaultBuilderSession ? "reuse" : "fresh",
        initialSourceSession: defaultBuilderSession
          ? toAgentSessionIdentity(defaultBuilderSession)
          : null,
        targetWorkingDirectory: conflictWorkingDirectory,
      });

      if (!session) {
        return false;
      }

      taskContext.onOpenSession(session);
      return true;
    },
    [loadPromptOverrides, startConflictResolutionSession, workspaceId],
  );

  return {
    handleResolveGitConflict,
  };
}
