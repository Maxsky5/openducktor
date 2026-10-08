import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { buildGitConflictAssistancePrompt } from "@openducktor/core";
import { useCallback } from "react";
import type { GitConflict } from "@/features/agent-studio-git";
import {
  buildReusableSessionOptions,
  type SessionStartWorkflowResult,
} from "@/features/session-start";
import { SessionStartWorkflowError } from "@/features/session-start/session-start-orchestration";
import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import type { AgentMessageSendOptions, AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  conflictRequestContext,
  GitConflictRequestCancelled,
  type GitConflictAssistanceResult,
} from "./conflict-assistance";
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
  assertCanSubmit?: AgentMessageSendOptions["assertCanSubmit"];
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
  ) => Promise<SessionStartWorkflowResult | undefined>;
  loadPromptOverrides?: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type UseGitConflictResolutionResult = {
  handleResolveGitConflict: (
    conflict: GitConflict,
    taskContext: GitConflictTaskContext,
    assertCanSubmit?: AgentMessageSendOptions["assertCanSubmit"],
    assertCurrent?: () => void,
  ) => Promise<GitConflictAssistanceResult>;
};

export function useGitConflictResolution({
  workspaceId,
  startConflictResolutionSession,
  loadPromptOverrides = loadEffectivePromptOverrides,
}: UseGitConflictResolutionArgs): UseGitConflictResolutionResult {
  const handleResolveGitConflict = useCallback(
    async (
      conflict: GitConflict,
      taskContext: GitConflictTaskContext,
      assertCanSubmit?: AgentMessageSendOptions["assertCanSubmit"],
      assertCurrent?: () => void,
    ): Promise<GitConflictAssistanceResult> => {
      if (!workspaceId) {
        throw new Error("Cannot resolve a git conflict because no repository is selected.");
      }

      const workingDirectory = normalizeWorkingDirectory(conflict.workingDir);
      if (!workingDirectory) {
        throw new Error(
          `Cannot resolve a git conflict for task "${taskContext.taskId}" because the conflicted working directory is missing.`,
        );
      }

      const matchingBuilders = taskContext.builderSessions.filter(
        (session) => normalizeWorkingDirectory(session.workingDirectory) === workingDirectory,
      );
      const defaultBuilder =
        matchingBuilders.find((session) =>
          matchesAgentSessionIdentity(session, taskContext.currentViewSession),
        ) ??
        matchingBuilders[0] ??
        null;

      const promptOverrides = await loadPromptOverrides(workspaceId);
      assertCurrent?.();
      const task: NonNullable<Parameters<typeof buildGitConflictAssistancePrompt>[0]["task"]> = {
        overrides: promptOverrides,
        context: { taskId: taskContext.taskId },
      };
      if (taskContext.task) {
        task.context = {
          taskId: taskContext.taskId,
          title: taskContext.task.title,
          issueType: taskContext.task.issueType,
          status: taskContext.task.status,
          qaRequired: taskContext.task.aiReviewEnabled,
          description: taskContext.task.description,
        };
      }
      const git = conflictRequestContext(conflict);
      const message = buildGitConflictAssistancePrompt({
        git,
        task,
      });

      const session = await startConflictResolutionSession({
        taskId: taskContext.taskId,
        role: "build",
        launchActionId: BUILD_REBASE_CONFLICT_RESOLUTION_LAUNCH_ACTION,
        message,
        existingSessionOptions: buildReusableSessionOptions({
          sessions: matchingBuilders,
          role: "build",
        }),
        initialStartMode: defaultBuilder ? "reuse" : "fresh",
        initialSourceSession: defaultBuilder ? toAgentSessionIdentity(defaultBuilder) : null,
        targetWorkingDirectory: git.workingDirectory,
        assertCanSubmit: (recipient) => {
          assertCurrent?.();
          if (normalizeWorkingDirectory(recipient.workingDirectory) !== workingDirectory)
            throw new Error("Select a Builder in the conflict directory before sending.");
          assertCanSubmit?.(recipient);
        },
      });

      if (!session) {
        return false;
      }

      const failure =
        session.postStartActionError instanceof SessionStartWorkflowError
          ? session.postStartActionError.originalCause
          : session.postStartActionError;
      if (failure instanceof GitConflictRequestCancelled) return false;
      assertCurrent?.();
      taskContext.onOpenSession(session);
      if (session.postStartActionError) throw session.postStartActionError;
      if (!session.postStartMessageReceipt)
        throw new Error(
          "The Builder started, but no conflict message was accepted. Send the request again from the conflict tools.",
        );
      return session.postStartMessageReceipt;
    },
    [loadPromptOverrides, startConflictResolutionSession, workspaceId],
  );

  return {
    handleResolveGitConflict,
  };
}
