import type { AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  type SelectAgentStudioSelection,
  toAgentStudioSessionlessRoleSelection,
  toAgentStudioSessionSelection,
} from "../shell/agent-studio-selection-state";

type UseAgentStudioSelectionActionsArgs = {
  taskId: string;
  sessionsForTask: AgentSessionSummary[];
  selectAgentStudioSelection: SelectAgentStudioSelection;
};

export function useAgentStudioSelectionActions({
  taskId,
  sessionsForTask,
  selectAgentStudioSelection,
}: UseAgentStudioSelectionActionsArgs) {
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

  return {
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
  } satisfies {
    handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
    handleSessionSelectionChange: (nextValue: string) => void;
  };
}
