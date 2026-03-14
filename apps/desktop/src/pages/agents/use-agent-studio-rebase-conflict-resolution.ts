import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";
import { loadEffectivePromptOverrides } from "../../state/operations/prompt-overrides";
import type { AgentStudioQueryUpdate } from "./agent-studio-navigation";
import { buildRebaseConflictResolutionPrompt } from "./agents-page-constants";
import {
  resolveAgentStudioBuilderSessionForTask,
  resolveAgentStudioBuilderSessionsForTask,
} from "./agents-page-selection";
import type { AgentStudioRebaseConflict } from "./use-agent-studio-git-actions";

export type RebaseConflictResolutionDecision =
  | {
      mode: "existing";
      sessionId: string;
    }
  | {
      mode: "new";
    }
  | null;

export type PendingRebaseConflictResolutionRequest = {
  requestId: string;
  conflict: AgentStudioRebaseConflict;
  builderSessions: AgentSessionState[];
  currentWorktreePath: string;
  currentViewSessionId: string | null;
  defaultMode: "existing" | "new";
  defaultSessionId: string | null;
};

type RebaseConflictResolutionRequestInput = Omit<
  PendingRebaseConflictResolutionRequest,
  "requestId"
>;

type AgentStudioRebaseConflictResolutionSelectionContext = {
  viewTaskId: string;
  viewSelectedTask: TaskCard | null;
  viewActiveSession: AgentSessionState | null;
  activeSession: AgentSessionState | null;
  selectedSessionById: AgentSessionState | null;
  viewSessionsForTask: AgentSessionState[];
  sessionsForTask: AgentSessionState[];
};

type UseAgentStudioRebaseConflictResolutionArgs = {
  activeRepo: string | null;
  selection: AgentStudioRebaseConflictResolutionSelectionContext;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  onContextSwitchIntent: () => void;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  loadPromptOverrides?: (repoPath: string) => Promise<RepoPromptOverrides>;
};

type UseAgentStudioRebaseConflictResolutionResult = {
  pendingRebaseConflictResolutionRequest: PendingRebaseConflictResolutionRequest | null;
  resolvePendingRebaseConflictResolution: (decision: RebaseConflictResolutionDecision) => void;
  handleResolveRebaseConflict: (conflict: AgentStudioRebaseConflict) => Promise<boolean>;
};

export function useAgentStudioRebaseConflictResolution({
  activeRepo,
  selection,
  scheduleQueryUpdate,
  onContextSwitchIntent,
  startAgentSession,
  sendAgentMessage,
  loadPromptOverrides = loadEffectivePromptOverrides,
}: UseAgentStudioRebaseConflictResolutionArgs): UseAgentStudioRebaseConflictResolutionResult {
  const [pendingRebaseConflictResolutionRequest, setPendingRebaseConflictResolutionRequest] =
    useState<PendingRebaseConflictResolutionRequest | null>(null);
  const pendingRebaseConflictResolutionResolverRef = useRef<
    ((decision: RebaseConflictResolutionDecision) => void) | null
  >(null);
  const requestSequenceRef = useRef(0);

  const resolvePendingRebaseConflictResolution = useCallback(
    (decision: RebaseConflictResolutionDecision): void => {
      const resolver = pendingRebaseConflictResolutionResolverRef.current;
      pendingRebaseConflictResolutionResolverRef.current = null;
      setPendingRebaseConflictResolutionRequest(null);
      resolver?.(decision);
    },
    [],
  );

  const requestRebaseConflictResolutionChoice = useCallback(
    (request: RebaseConflictResolutionRequestInput): Promise<RebaseConflictResolutionDecision> => {
      pendingRebaseConflictResolutionResolverRef.current?.(null);
      return new Promise((resolve) => {
        pendingRebaseConflictResolutionResolverRef.current = resolve;
        const requestId = `rebase-conflict-${requestSequenceRef.current}`;
        requestSequenceRef.current += 1;
        setPendingRebaseConflictResolutionRequest({
          ...request,
          requestId,
        });
      });
    },
    [],
  );

  useEffect(() => {
    return () => {
      pendingRebaseConflictResolutionResolverRef.current?.(null);
      pendingRebaseConflictResolutionResolverRef.current = null;
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

  const handleResolveRebaseConflict = useCallback(
    async (conflict: AgentStudioRebaseConflict): Promise<boolean> => {
      if (!activeRepo) {
        throw new Error("Cannot resolve rebase conflict because no repository is selected.");
      }
      if (!selection.viewTaskId) {
        throw new Error("Cannot resolve rebase conflict because no task is selected.");
      }

      const builderSessions = resolveAgentStudioBuilderSessionsForTask({
        taskId: selection.viewTaskId,
        viewActiveSession: selection.viewActiveSession,
        activeSession: selection.activeSession,
        selectedSessionById: selection.selectedSessionById,
        viewSessionsForTask: selection.viewSessionsForTask,
        sessionsForTask: selection.sessionsForTask,
      });
      const defaultBuilderSession = resolveAgentStudioBuilderSessionForTask({
        taskId: selection.viewTaskId,
        viewActiveSession: selection.viewActiveSession,
        activeSession: selection.activeSession,
        selectedSessionById: selection.selectedSessionById,
        viewSessionsForTask: selection.viewSessionsForTask,
        sessionsForTask: selection.sessionsForTask,
      });
      const currentWorktreePath = (conflict.workingDir ?? activeRepo)?.trim() ?? "";
      if (!currentWorktreePath) {
        throw new Error(
          "Cannot resolve rebase conflict because the current worktree path is unavailable.",
        );
      }

      const decision = await requestRebaseConflictResolutionChoice({
        conflict,
        builderSessions,
        currentWorktreePath,
        currentViewSessionId:
          selection.viewActiveSession?.role === "build"
            ? selection.viewActiveSession.sessionId
            : null,
        defaultMode: defaultBuilderSession ? "existing" : "new",
        defaultSessionId: defaultBuilderSession?.sessionId ?? null,
      });
      if (!decision) {
        return false;
      }

      const promptOverrides = await loadPromptOverrides(activeRepo);
      const message = buildRebaseConflictResolutionPrompt(selection.viewTaskId, {
        overrides: promptOverrides,
        ...(selection.viewSelectedTask
          ? {
              task: {
                title: selection.viewSelectedTask.title,
                issueType: selection.viewSelectedTask.issueType,
                status: selection.viewSelectedTask.status,
                qaRequired: selection.viewSelectedTask.aiReviewEnabled,
                description: selection.viewSelectedTask.description,
              },
            }
          : {}),
        git: {
          ...(conflict.currentBranch ? { currentBranch: conflict.currentBranch } : {}),
          targetBranch: conflict.targetBranch,
          conflictedFiles: conflict.conflictedFiles,
          rebaseOutput: conflict.output,
        },
      });

      if (decision.mode === "existing") {
        const builderSession = builderSessions.find(
          (session) => session.sessionId === decision.sessionId,
        );
        if (!builderSession) {
          throw new Error("Selected Builder session is no longer available for this task.");
        }

        if (
          selection.viewActiveSession?.sessionId !== builderSession.sessionId ||
          selection.viewActiveSession?.role !== builderSession.role
        ) {
          onContextSwitchIntent();
          scheduleQueryUpdate({
            task: builderSession.taskId,
            session: builderSession.sessionId,
            agent: builderSession.role,
          });
        }

        sendConflictResolutionMessage(builderSession.sessionId, message);
        return true;
      }

      const sessionId = await startAgentSession({
        taskId: selection.viewTaskId,
        role: "build",
        scenario: "build_rebase_conflict_resolution",
        selectedModel: defaultBuilderSession?.selectedModel ?? null,
        sendKickoff: false,
        startMode: "fresh",
        requireModelReady: true,
        workingDirectoryOverride: currentWorktreePath,
      });

      onContextSwitchIntent();
      scheduleQueryUpdate({
        task: selection.viewTaskId,
        session: sessionId,
        agent: "build",
      });
      sendConflictResolutionMessage(sessionId, message);
      return true;
    },
    [
      activeRepo,
      onContextSwitchIntent,
      requestRebaseConflictResolutionChoice,
      scheduleQueryUpdate,
      selection,
      sendConflictResolutionMessage,
      startAgentSession,
      loadPromptOverrides,
    ],
  );

  return {
    pendingRebaseConflictResolutionRequest,
    resolvePendingRebaseConflictResolution,
    handleResolveRebaseConflict,
  };
}
