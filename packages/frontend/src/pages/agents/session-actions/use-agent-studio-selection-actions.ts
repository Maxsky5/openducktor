import type { AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import {
  type SelectAgentStudioSelection,
  toAgentStudioSessionlessRoleSelection,
  toAgentStudioSessionSelection,
} from "../shell/agent-studio-selection-state";

type CanPrepareMessageFirstSession = (option: SessionCreateOption) => boolean;

type UseAgentStudioSelectionActionsArgs = {
  taskId: string;
  sessionsForTask: AgentSessionSummary[];
  canPrepareMessageFirstSession: CanPrepareMessageFirstSession;
  selectAgentStudioSelection: SelectAgentStudioSelection;
};

export function useAgentStudioSelectionActions({
  taskId,
  sessionsForTask,
  canPrepareMessageFirstSession,
  selectAgentStudioSelection,
}: UseAgentStudioSelectionActionsArgs): {
  handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
} {
  const findSessionByValue = useCallback(
    (sessionValue: string): AgentSessionSummary | null =>
      sessionsForTask.find((session) => agentSessionIdentityKey(session) === sessionValue) ?? null,
    [sessionsForTask],
  );

  const handleWorkflowStepSelect = useCallback(
    (nextRole: AgentRole, sessionValue: string | null): void => {
      if (!taskId) {
        return;
      }

      if (!sessionValue) {
        selectAgentStudioSelection(
          toAgentStudioSessionlessRoleSelection({
            taskId,
            role: nextRole,
          }),
        );
        return;
      }

      const session = findSessionByValue(sessionValue);
      if (!session) {
        return;
      }

      selectAgentStudioSelection(toAgentStudioSessionSelection(session));
    },
    [findSessionByValue, selectAgentStudioSelection, taskId],
  );

  const handleSessionSelectionChange = useCallback(
    (nextValue: string): void => {
      if (!taskId) {
        return;
      }

      const selectedSession = findSessionByValue(nextValue);
      if (!selectedSession) {
        return;
      }

      selectAgentStudioSelection(toAgentStudioSessionSelection(selectedSession));
    },
    [findSessionByValue, selectAgentStudioSelection, taskId],
  );

  const handlePrepareMessageFirstSession = useCallback(
    (option: SessionCreateOption): void => {
      if (!canPrepareMessageFirstSession(option)) {
        return;
      }

      selectAgentStudioSelection(
        toAgentStudioSessionlessRoleSelection({
          taskId,
          role: option.role,
        }),
      );
    },
    [canPrepareMessageFirstSession, selectAgentStudioSelection, taskId],
  );

  return {
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handlePrepareMessageFirstSession,
  };
}
