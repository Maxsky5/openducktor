import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import {
  type AgentSessionSummary,
  isWorkflowAgentSessionSummary,
} from "@/state/agent-sessions-store";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  applyAgentStudioSelectionQuery,
  canStartSessionForRole,
  type QueryUpdate,
  shouldTriggerContextSwitchIntent,
} from "./use-agent-studio-session-action-helpers";

type SelectionIntentScheduler = (intent: {
  taskId: string;
  externalSessionId: string | null;
  role: AgentRole;
}) => void;

type UseAgentStudioSelectionActionsArgs = {
  taskId: string;
  activeExternalSessionId: string | null;
  activeSessionRole: AgentRole;
  activeSessionExists: boolean;
  agentStudioReady: boolean;
  isActiveTaskHydrated: boolean;
  isSessionWorking: boolean;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent: SelectionIntentScheduler | undefined;
  onContextSwitchIntent: (() => void) | undefined;
};

type ApplySelectionIntentParams = {
  currentExternalSessionId: string | null;
  currentRole: AgentRole;
  nextTaskId: string;
  nextExternalSessionId: string | null;
  nextRole: AgentRole;
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent: SelectionIntentScheduler | undefined;
  onContextSwitchIntent: (() => void) | undefined;
};

const applySelectionIntent = ({
  currentExternalSessionId,
  currentRole,
  nextTaskId,
  nextExternalSessionId,
  nextRole,
  updateQuery,
  scheduleSelectionIntent,
  onContextSwitchIntent,
}: ApplySelectionIntentParams): void => {
  if (
    shouldTriggerContextSwitchIntent({
      currentExternalSessionId,
      currentRole,
      nextSessionId: nextExternalSessionId,
      nextRole,
    })
  ) {
    onContextSwitchIntent?.();
  }

  applyAgentStudioSelectionQuery(updateQuery, {
    taskId: nextTaskId,
    externalSessionId: nextExternalSessionId ?? undefined,
    role: nextRole,
  });
  scheduleSelectionIntent?.({
    taskId: nextTaskId,
    externalSessionId: nextExternalSessionId,
    role: nextRole,
  });
};

export function useAgentStudioSelectionActions({
  taskId,
  activeExternalSessionId,
  activeSessionRole,
  activeSessionExists,
  agentStudioReady,
  isActiveTaskHydrated,
  isSessionWorking,
  sessionsForTask,
  selectedTask,
  updateQuery,
  scheduleSelectionIntent,
  onContextSwitchIntent,
}: UseAgentStudioSelectionActionsArgs): {
  handleWorkflowStepSelect: (role: AgentRole, externalSessionId: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
} {
  const handleWorkflowStepSelect = useCallback(
    (nextRole: AgentRole, externalSessionId: string | null): void => {
      if (!taskId) {
        return;
      }

      if (!externalSessionId) {
        applySelectionIntent({
          currentExternalSessionId: activeExternalSessionId,
          currentRole: activeSessionRole,
          nextTaskId: taskId,
          nextExternalSessionId: null,
          nextRole,
          updateQuery,
          scheduleSelectionIntent,
          onContextSwitchIntent,
        });
        return;
      }

      const session = sessionsForTask.find(
        (entry) => entry.externalSessionId === externalSessionId,
      );
      if (!isWorkflowAgentSessionSummary(session)) {
        return;
      }

      applySelectionIntent({
        currentExternalSessionId: activeExternalSessionId,
        currentRole: activeSessionRole,
        nextTaskId: session.taskId,
        nextExternalSessionId: session.externalSessionId,
        nextRole: session.role,
        updateQuery,
        scheduleSelectionIntent,
        onContextSwitchIntent,
      });
    },
    [
      activeExternalSessionId,
      activeSessionRole,
      onContextSwitchIntent,
      scheduleSelectionIntent,
      sessionsForTask,
      taskId,
      updateQuery,
    ],
  );

  const handleSessionSelectionChange = useCallback(
    (nextValue: string): void => {
      if (!taskId) {
        return;
      }

      const selectedSession = sessionsForTask.find(
        (entry) => entry.externalSessionId === nextValue,
      );
      if (!isWorkflowAgentSessionSummary(selectedSession)) {
        return;
      }

      applySelectionIntent({
        currentExternalSessionId: activeExternalSessionId,
        currentRole: activeSessionRole,
        nextTaskId: selectedSession.taskId,
        nextExternalSessionId: selectedSession.externalSessionId,
        nextRole: selectedSession.role,
        updateQuery,
        scheduleSelectionIntent,
        onContextSwitchIntent,
      });
    },
    [
      activeExternalSessionId,
      activeSessionRole,
      onContextSwitchIntent,
      scheduleSelectionIntent,
      sessionsForTask,
      taskId,
      updateQuery,
    ],
  );

  const handlePrepareMessageFirstSession = useCallback(
    (option: SessionCreateOption): void => {
      if (option.disabled || !taskId || !agentStudioReady || !isActiveTaskHydrated) {
        return;
      }
      if (activeSessionExists && isSessionWorking) {
        return;
      }
      if (!canStartSessionForRole(selectedTask, option.role)) {
        return;
      }

      applySelectionIntent({
        currentExternalSessionId: activeExternalSessionId,
        currentRole: activeSessionRole,
        nextTaskId: taskId,
        nextExternalSessionId: null,
        nextRole: option.role,
        updateQuery,
        scheduleSelectionIntent,
        onContextSwitchIntent,
      });
    },
    [
      activeExternalSessionId,
      activeSessionExists,
      activeSessionRole,
      agentStudioReady,
      isActiveTaskHydrated,
      isSessionWorking,
      onContextSwitchIntent,
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
