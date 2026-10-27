import type { RepoPromptOverrides } from "@openducktor/contracts";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { useCallback } from "react";
import type { GitConflict } from "../contracts";
import { SessionStartWorkflowError } from "../../sessions/start/session-start-orchestration";
import { buildReusableSessionOptions } from "../../sessions/start/session-start-reuse-options";
import type { SessionStartWorkflowResult } from "../../sessions/start/session-start-workflow";
import type { SessionStartFlowRequest } from "../../sessions/start/session-start-types";
import { toAgentSessionIdentity } from "../../lib/agent-session-identity";
import { normalizeWorkingDirectory } from "../../lib/working-directory";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";
import { loadEffectivePromptOverrides } from "../../queries/prompt-overrides";
import type { AgentMessageSendOptions, AgentSessionIdentity } from "../../types/agent-orchestrator";
import {
  BUILD_REBASE_CONFLICT_RESOLUTION_LAUNCH_ACTION,
  buildTaskConflictPrompt,
  conflictBuilderSessions,
  conflictRequestContext,
  GitConflictRequestCancelled,
  type GitConflictAssistanceResult,
} from "./conflict-assistance";
import { useQueryClient } from "@tanstack/react-query";

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
  assertBeforeLaunch?: () => void;
};

/** The session start request of a conflict request: start or reuse a Builder, then send it. */
export type ConflictResolutionStartRequest = SessionStartFlowRequest & {
  role: "build";
  launchActionId: "build_rebase_conflict_resolution";
  postStartAction: "send_message";
  message: string;
  targetWorkingDirectory: string;
  initialSourceSession: AgentSessionIdentity | null;
};

/** Maps a conflict request to the session start request that a client runs. */
export const toConflictResolutionStartRequest = (
  request: StartGitConflictResolutionSessionInput,
): ConflictResolutionStartRequest => {
  const startRequest: ConflictResolutionStartRequest = {
    taskId: request.taskId,
    role: request.role,
    launchActionId: request.launchActionId,
    postStartAction: "send_message",
    message: request.message,
    initialStartMode: request.initialStartMode,
    targetWorkingDirectory: request.targetWorkingDirectory,
    initialSourceSession: request.initialSourceSession,
  };
  if (request.existingSessionOptions.length > 0) {
    startRequest.existingSessionOptions = request.existingSessionOptions;
  }
  if (request.assertCanSubmit) startRequest.assertCanSubmit = request.assertCanSubmit;
  if (request.assertBeforeLaunch) startRequest.assertBeforeLaunch = request.assertBeforeLaunch;
  return startRequest;
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
  loadPromptOverrides?: ((workspaceId: string) => Promise<RepoPromptOverrides>) | undefined;
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
  loadPromptOverrides: suppliedLoadPromptOverrides,
}: UseGitConflictResolutionArgs): UseGitConflictResolutionResult {
  const queryClient = useQueryClient();
  const loadPromptOverrides = useCallback(
    (id: string) =>
      suppliedLoadPromptOverrides
        ? suppliedLoadPromptOverrides(id)
        : loadEffectivePromptOverrides(id, queryClient),
    [queryClient, suppliedLoadPromptOverrides],
  );
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

      const { matching: matchingBuilders, defaultBuilder } = conflictBuilderSessions(
        conflict,
        taskContext.builderSessions,
        taskContext.currentViewSession,
      );

      const promptOverrides = await loadPromptOverrides(workspaceId);
      assertCurrent?.();
      const git = conflictRequestContext(conflict);
      const message = buildTaskConflictPrompt({
        conflict,
        taskId: taskContext.taskId,
        task: taskContext.task,
        overrides: promptOverrides,
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
        assertBeforeLaunch: () => assertCurrent?.(),
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
      if (session.postStartMessageReceipt) return session.postStartMessageReceipt;
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
