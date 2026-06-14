import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionSummary,
  isWorkflowAgentSessionSummary,
} from "@/state/agent-sessions-store";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import {
  applyAgentStudioSelectionQuery,
  canStartSessionForRole,
  type QueryUpdate,
} from "../use-agent-studio-session-action-helpers";

type SelectionIntentScheduler = (intent: {
  taskId: string;
  externalSessionId: string | null;
  role: AgentRole;
}) => void;

type UseAgentStudioSelectionActionsArgs = {
  taskId: string;
  activeSessionExists: boolean;
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
  isSessionWorking: boolean;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent: SelectionIntentScheduler | undefined;
};

type ApplySelectionIntentParams = {
  nextTaskId: string;
  nextSessionRoute: AgentSessionSummary | null;
  nextRole: AgentRole;
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent: SelectionIntentScheduler | undefined;
};

const applySelectionIntent = ({
  nextTaskId,
  nextSessionRoute,
  nextRole,
  updateQuery,
  scheduleSelectionIntent,
}: ApplySelectionIntentParams): void => {
  applyAgentStudioSelectionQuery(updateQuery, {
    taskId: nextTaskId,
    session: nextSessionRoute,
    role: nextRole,
  });
  scheduleSelectionIntent?.({
    taskId: nextTaskId,
    externalSessionId: nextSessionRoute?.externalSessionId ?? null,
    role: nextRole,
  });
};

export function useAgentStudioSelectionActions({
  taskId,
  activeSessionExists,
  agentStudioReady,
  isActiveTaskReady,
  isSessionWorking,
  sessionsForTask,
  selectedTask,
  updateQuery,
  scheduleSelectionIntent,
}: UseAgentStudioSelectionActionsArgs): {
  handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
} {
  const findSessionByValue = useCallback(
    (sessionValue: string): AgentSessionSummary | null =>
      sessionsForTask.find((entry) => agentSessionIdentityKey(entry) === sessionValue) ?? null,
    [sessionsForTask],
  );

  const handleWorkflowStepSelect = useCallback(
    (nextRole: AgentRole, sessionValue: string | null): void => {
      if (!taskId) {
        return;
      }

      if (!sessionValue) {
        applySelectionIntent({
          nextTaskId: taskId,
          nextSessionRoute: null,
          nextRole,
          updateQuery,
          scheduleSelectionIntent,
        });
        return;
      }

      const session = findSessionByValue(sessionValue);
      if (!isWorkflowAgentSessionSummary(session)) {
        return;
      }

      applySelectionIntent({
        nextTaskId: session.taskId,
        nextSessionRoute: session,
        nextRole: session.role,
        updateQuery,
        scheduleSelectionIntent,
      });
    },
    [findSessionByValue, scheduleSelectionIntent, taskId, updateQuery],
  );

  const handleSessionSelectionChange = useCallback(
    (nextValue: string): void => {
      if (!taskId) {
        return;
      }

      const selectedSession = findSessionByValue(nextValue);
      if (!isWorkflowAgentSessionSummary(selectedSession)) {
        return;
      }

      applySelectionIntent({
        nextTaskId: selectedSession.taskId,
        nextSessionRoute: selectedSession,
        nextRole: selectedSession.role,
        updateQuery,
        scheduleSelectionIntent,
      });
    },
    [findSessionByValue, scheduleSelectionIntent, taskId, updateQuery],
  );

  const handlePrepareMessageFirstSession = useCallback(
    (option: SessionCreateOption): void => {
      if (option.disabled || !taskId || !agentStudioReady || !isActiveTaskReady) {
        return;
      }
      if (activeSessionExists && isSessionWorking) {
        return;
      }
      if (!canStartSessionForRole(selectedTask, option.role)) {
        return;
      }

      applySelectionIntent({
        nextTaskId: taskId,
        nextSessionRoute: null,
        nextRole: option.role,
        updateQuery,
        scheduleSelectionIntent,
      });
    },
    [
      activeSessionExists,
      agentStudioReady,
      isActiveTaskReady,
      isSessionWorking,
      scheduleSelectionIntent,
      selectedTask,
      taskId,
      updateQuery,
    ],
  );

  return {
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handlePrepareMessageFirstSession,
  };
}
