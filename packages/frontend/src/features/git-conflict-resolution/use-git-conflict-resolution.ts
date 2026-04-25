import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { useCallback } from "react";
import type { GitConflict } from "@/features/agent-studio-git";
import {
  buildGitConflictResolutionPrompt,
  buildReusableSessionOptions,
} from "@/features/session-start";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import type { ActiveWorkspace } from "@/types/state-slices";
import { getGitConflictCopy } from "./conflict-copy";
import { BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO } from "./constants";

export type StartGitConflictResolutionSessionInput = {
  taskId: string;
  role: "build";
  scenario: typeof BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO;
  message: string;
  existingSessionOptions: ReturnType<typeof buildReusableSessionOptions>;
  initialStartMode: "fresh" | "reuse";
  initialSourceSessionId: string | null;
  targetWorkingDirectory: string;
};

type GitConflictTaskContext = {
  taskId: string;
  task: TaskCard | null;
  builderSessions: AgentSessionSummary[];
  currentViewSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
};

type UseGitConflictResolutionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  startConflictResolutionSession: (
    input: StartGitConflictResolutionSessionInput,
  ) => Promise<string | undefined>;
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
  currentViewSessionId,
}: {
  builderSessions: AgentSessionSummary[];
  currentViewSessionId: string | null;
}): AgentSessionSummary | null => {
  return (
    builderSessions.find((session) => session.sessionId === currentViewSessionId) ??
    builderSessions[0] ??
    null
  );
};

export function useGitConflictResolution({
  activeWorkspace,
  startConflictResolutionSession,
  loadPromptOverrides = loadEffectivePromptOverrides,
}: UseGitConflictResolutionArgs): UseGitConflictResolutionResult {
  const handleResolveGitConflict = useCallback(
    async (conflict: GitConflict, taskContext: GitConflictTaskContext): Promise<boolean> => {
      if (!activeWorkspace) {
        throw new Error("Cannot resolve a git conflict because no repository is selected.");
      }

      const activeWorkspaceId = activeWorkspace.workspaceId;
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
        currentViewSessionId: taskContext.currentViewSessionId,
      });

      const promptOverrides = await loadPromptOverrides(activeWorkspaceId);
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

      const sessionId = await startConflictResolutionSession({
        taskId: taskContext.taskId,
        role: "build",
        scenario: BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO,
        message,
        existingSessionOptions: buildReusableSessionOptions({
          sessions: validBuilderSessions,
          role: "build",
        }),
        initialStartMode: defaultBuilderSession ? "reuse" : "fresh",
        initialSourceSessionId: defaultBuilderSession?.sessionId ?? null,
        targetWorkingDirectory: conflictWorkingDirectory,
      });

      if (!sessionId) {
        return false;
      }

      taskContext.onOpenSession(sessionId);
      return true;
    },
    [activeWorkspace, loadPromptOverrides, startConflictResolutionSession],
  );

  return {
    handleResolveGitConflict,
  };
}
