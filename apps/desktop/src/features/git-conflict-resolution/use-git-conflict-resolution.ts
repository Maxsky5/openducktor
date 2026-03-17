import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { GitConflict } from "@/features/agent-studio-git";
import { buildGitConflictResolutionPrompt } from "@/features/session-start";
import { errorMessage } from "@/lib/errors";
import { loadEffectivePromptOverrides } from "@/state/operations/prompt-overrides";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { getGitConflictCopy } from "./conflict-copy";

export type GitConflictResolutionDecision =
  | {
      mode: "existing";
      sessionId: string;
    }
  | {
      mode: "new";
    }
  | null;

export type PendingGitConflictResolutionRequest = {
  requestId: string;
  conflict: GitConflict;
  builderSessions: AgentSessionState[];
  currentWorktreePath: string;
  currentViewSessionId: string | null;
  defaultMode: "existing" | "new";
  defaultSessionId: string | null;
};

type GitConflictTaskContext = {
  taskId: string;
  task: TaskCard | null;
  builderSessions: AgentSessionState[];
  currentViewSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
};

type GitConflictResolutionRequestInput = Omit<PendingGitConflictResolutionRequest, "requestId">;

type UseGitConflictResolutionArgs = {
  activeRepo: string | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  loadPromptOverrides?: (repoPath: string) => Promise<RepoPromptOverrides>;
};

type UseGitConflictResolutionResult = {
  pendingGitConflictResolutionRequest: PendingGitConflictResolutionRequest | null;
  resolvePendingGitConflictResolution: (decision: GitConflictResolutionDecision) => void;
  handleResolveGitConflict: (
    conflict: GitConflict,
    taskContext: GitConflictTaskContext,
  ) => Promise<boolean>;
};

const normalizePath = (path: string | null | undefined): string =>
  (path ?? "").trim().replace(/\/+$/, "");

export function useGitConflictResolution({
  activeRepo,
  startAgentSession,
  sendAgentMessage,
  loadPromptOverrides = loadEffectivePromptOverrides,
}: UseGitConflictResolutionArgs): UseGitConflictResolutionResult {
  const [pendingGitConflictResolutionRequest, setPendingGitConflictResolutionRequest] =
    useState<PendingGitConflictResolutionRequest | null>(null);
  const pendingResolverRef = useRef<((decision: GitConflictResolutionDecision) => void) | null>(
    null,
  );
  const requestSequenceRef = useRef(0);

  const resolvePendingGitConflictResolution = useCallback(
    (decision: GitConflictResolutionDecision): void => {
      const resolver = pendingResolverRef.current;
      pendingResolverRef.current = null;
      setPendingGitConflictResolutionRequest(null);
      resolver?.(decision);
    },
    [],
  );

  const requestGitConflictResolutionChoice = useCallback(
    (request: GitConflictResolutionRequestInput): Promise<GitConflictResolutionDecision> => {
      pendingResolverRef.current?.(null);
      return new Promise((resolve) => {
        pendingResolverRef.current = resolve;
        const requestId = `git-conflict-${requestSequenceRef.current}`;
        requestSequenceRef.current += 1;
        setPendingGitConflictResolutionRequest({
          ...request,
          requestId,
        });
      });
    },
    [],
  );

  useEffect(() => {
    return () => {
      pendingResolverRef.current?.(null);
      pendingResolverRef.current = null;
    };
  }, []);

  const sendConflictResolutionMessage = useCallback(
    (sessionId: string, message: string): void => {
      void sendAgentMessage(sessionId, message).catch((error) => {
        toast.error("Failed to send Builder conflict resolution request", {
          description: errorMessage(error),
        });
      });
    },
    [sendAgentMessage],
  );

  const handleResolveGitConflict = useCallback(
    async (conflict: GitConflict, taskContext: GitConflictTaskContext): Promise<boolean> => {
      if (!activeRepo) {
        throw new Error("Cannot resolve a git conflict because no repository is selected.");
      }

      const currentWorktreePath = normalizePath(conflict.workingDir ?? activeRepo);
      if (!currentWorktreePath) {
        throw new Error(
          "Cannot resolve a git conflict because the paused worktree is unavailable.",
        );
      }

      const matchingBuilderSessions = taskContext.builderSessions.filter(
        (session) => normalizePath(session.workingDirectory) === currentWorktreePath,
      );
      const defaultBuilderSession = matchingBuilderSessions[0] ?? null;
      const decision = await requestGitConflictResolutionChoice({
        conflict,
        builderSessions: matchingBuilderSessions,
        currentWorktreePath,
        currentViewSessionId: taskContext.currentViewSessionId,
        defaultMode: defaultBuilderSession ? "existing" : "new",
        defaultSessionId: defaultBuilderSession?.sessionId ?? null,
      });
      if (!decision) {
        return false;
      }

      const promptOverrides = await loadPromptOverrides(activeRepo);
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

      if (decision.mode === "existing") {
        const builderSession = matchingBuilderSessions.find(
          (session) => session.sessionId === decision.sessionId,
        );
        if (!builderSession) {
          throw new Error("Selected Builder session is no longer available for this worktree.");
        }

        taskContext.onOpenSession(builderSession.sessionId);
        sendConflictResolutionMessage(builderSession.sessionId, message);
        return true;
      }

      const sessionId = await startAgentSession({
        taskId: taskContext.taskId,
        role: "build",
        scenario: "build_rebase_conflict_resolution",
        selectedModel: defaultBuilderSession?.selectedModel ?? null,
        sendKickoff: false,
        startMode: "fresh",
        requireModelReady: true,
        workingDirectoryOverride: currentWorktreePath,
      });

      taskContext.onOpenSession(sessionId);
      sendConflictResolutionMessage(sessionId, message);
      return true;
    },
    [
      activeRepo,
      loadPromptOverrides,
      requestGitConflictResolutionChoice,
      sendConflictResolutionMessage,
      startAgentSession,
    ],
  );

  return {
    pendingGitConflictResolutionRequest,
    resolvePendingGitConflictResolution,
    handleResolveGitConflict,
  };
}
