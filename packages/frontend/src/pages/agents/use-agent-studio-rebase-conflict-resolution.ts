import { taskGitConflictLaunch, type PromptSettings } from "@openducktor/workflows";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { GitConflict } from "@openducktor/frontend-core/git/contracts";
import {
  type StartGitConflictResolutionSessionInput,
  toConflictResolutionStartRequest,
  useGitConflictResolution,
} from "@openducktor/frontend-core/git/conflicts/use-git-conflict-resolution";
import {
  GitConflictRequestCancelled,
  type ResolveGitConflict,
} from "@openducktor/frontend-core/git/conflicts/conflict-assistance";
import type { SessionStartExistingSessionOption } from "@openducktor/frontend-core/sessions/start/session-start-types";
import type { SessionStartLaunchRequest } from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import type { SessionStartWorkflowResult } from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import {
  matchesAgentSessionIdentity,
  toAgentSessionIdentity,
} from "@openducktor/frontend-core/lib/agent-session-identity";
import type {
  AgentMessageSendOptions,
  AgentSessionIdentity,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { resolveAgentStudioBuilderSessionsForTask } from "./agents-page-selection";
import {
  type AgentStudioQueryUpdate,
  buildAgentStudioSelectionQueryUpdate,
} from "./query-sync/agent-studio-navigation";
import type { AgentStudioSelectionControllerResult } from "./use-agent-studio-selection-controller";

type AgentStudioRebaseConflictResolutionSelectionContext = {
  view: Pick<
    AgentStudioSelectionControllerResult["view"],
    "taskId" | "role" | "selectedTask" | "selectedSession" | "sessionsForTask"
  >;
};

type UseAgentStudioRebaseConflictResolutionArgs = {
  workspaceId: string | null;
  assertSessionCanSend: NonNullable<AgentMessageSendOptions["assertCanSubmit"]>;
  selection: AgentStudioRebaseConflictResolutionSelectionContext;
  scheduleQueryUpdate: (updates: AgentStudioQueryUpdate) => void;
  startSessionRequest: (
    request: SessionStartLaunchRequest & {
      role: string;
      launchActionId: string;
      postStartAction: "send_message";
      message: string;
      targetWorkingDirectory?: string | null;
      existingSessionOptions?: SessionStartExistingSessionOption[];
      initialSourceSession?: AgentSessionIdentity | null;
    },
  ) => Promise<SessionStartWorkflowResult | undefined>;
  loadPromptSettings?: ((workspaceId: string) => Promise<PromptSettings>) | undefined;
};

type UseAgentStudioRebaseConflictResolutionResult = {
  handleResolveRebaseConflict: ResolveGitConflict;
};

export function useAgentStudioRebaseConflictResolution({
  workspaceId,
  assertSessionCanSend,
  selection,
  scheduleQueryUpdate,
  startSessionRequest,
  loadPromptSettings,
}: UseAgentStudioRebaseConflictResolutionArgs): UseAgentStudioRebaseConflictResolutionResult {
  const startConflictResolutionSession = useCallback(
    (request: StartGitConflictResolutionSessionInput) =>
      startSessionRequest(toConflictResolutionStartRequest(request)),
    [startSessionRequest],
  );

  const { handleResolveGitConflict } = useGitConflictResolution({
    workspaceId,
    startConflictResolutionSession,
    loadPromptSettings,
  });
  const { view } = selection;
  const selectionKey = JSON.stringify([workspaceId, view.taskId, view.selectedSession.identity]);
  const current = useRef({ key: selectionKey, version: 0 });
  const opening = useRef<{ key: string; request: { version: number } } | null>(null);
  useLayoutEffect(() => {
    if (current.current.key === selectionKey) return;
    const version = current.current.version + 1;
    // Only the request that opens this Builder can keep its failed-message retry.
    if (
      opening.current?.key === selectionKey &&
      opening.current.request.version === current.current.version
    ) {
      opening.current.request.version = version;
    }
    opening.current = null;
    current.current = { key: selectionKey, version };
  }, [selectionKey]);

  const handleResolveRebaseConflict = useCallback(
    async (conflict: GitConflict, ownerGuard = () => {}) => {
      const request = { version: current.current.version };
      const assertCurrent = () => {
        ownerGuard();
        if (current.current.version !== request.version) throw new GitConflictRequestCancelled();
      };
      if (!view.taskId) {
        throw new Error("Cannot resolve a git conflict because no task is selected.");
      }

      const launch = view.selectedTask && taskGitConflictLaunch(view.selectedTask);
      if (!launch)
        throw new Error(
          "This task has no available conflict-resolution launch. Open its workflow actions.",
        );
      const builderSessions = resolveAgentStudioBuilderSessionsForTask({
        role: launch.role,
        taskId: view.taskId,
        candidateSessions: [view.selectedSession.loadedSession, ...view.sessionsForTask],
      });
      const defaultBuilderSession = builderSessions[0] ?? null;

      return handleResolveGitConflict(
        conflict,
        {
          taskId: view.taskId,
          task: view.selectedTask,
          builderSessions,
          currentViewSession: view.role === launch.role ? view.selectedSession.identity : null,
          onOpenSession: (session) => {
            assertCurrent();
            const identity = toAgentSessionIdentity(session);
            const key = JSON.stringify([workspaceId, view.taskId, identity]);
            opening.current = key === current.current.key ? null : { key, request };
            const builderSession =
              builderSessions.find((entry) => matchesAgentSessionIdentity(entry, session)) ?? null;
            scheduleQueryUpdate(
              buildAgentStudioSelectionQueryUpdate({
                taskId: view.taskId,
                sessionExternalId: identity.externalSessionId,
                role: builderSession?.role ?? defaultBuilderSession?.role ?? launch.role,
              }),
            );
          },
        },
        (session) => {
          assertCurrent();
          assertSessionCanSend(session);
        },
        assertCurrent,
      );
    },
    [handleResolveGitConflict, scheduleQueryUpdate, view, assertSessionCanSend, workspaceId],
  );

  return {
    handleResolveRebaseConflict,
  };
}
