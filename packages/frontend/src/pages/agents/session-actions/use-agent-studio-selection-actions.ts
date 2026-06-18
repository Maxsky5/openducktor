import type { AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { WorkflowAgentSessionSummary } from "@/state/agent-sessions-store";
import { findAgentStudioSessionSummaryByKey } from "../agents-page-selection";
import type { SessionCreateOption } from "../agents-page-session-tabs";
import {
  buildAgentStudioSelectionQueryUpdate,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "../query-sync/agent-studio-navigation";
import type { AgentStudioSelectionIntent } from "../shell/agent-studio-selection-intent";

type SelectionIntentScheduler = (intent: AgentStudioSelectionIntent) => void;
type CanPrepareMessageFirstSession = (option: SessionCreateOption) => boolean;

type UseAgentStudioSelectionActionsArgs = {
  taskId: string;
  sessionsForTask: WorkflowAgentSessionSummary[];
  canPrepareMessageFirstSession: CanPrepareMessageFirstSession;
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent: SelectionIntentScheduler | undefined;
};

type ApplySelectionIntentParams = {
  nextTaskId: string;
  nextSessionIdentity: WorkflowAgentSessionSummary | null;
  nextRole: AgentRole;
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent: SelectionIntentScheduler | undefined;
};

const applySelectionIntent = ({
  nextTaskId,
  nextSessionIdentity,
  nextRole,
  updateQuery,
  scheduleSelectionIntent,
}: ApplySelectionIntentParams): void => {
  updateQuery(
    buildAgentStudioSelectionQueryUpdate({
      taskId: nextTaskId,
      session: nextSessionIdentity,
      role: nextRole,
    }),
  );
  scheduleSelectionIntent?.({
    taskId: nextTaskId,
    sessionIdentity: nextSessionIdentity ? toAgentSessionIdentity(nextSessionIdentity) : null,
    role: nextRole,
  });
};

export function useAgentStudioSelectionActions({
  taskId,
  sessionsForTask,
  canPrepareMessageFirstSession,
  updateQuery,
  scheduleSelectionIntent,
}: UseAgentStudioSelectionActionsArgs): {
  handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
} {
  const findSessionByValue = useCallback(
    (sessionValue: string): WorkflowAgentSessionSummary | null =>
      findAgentStudioSessionSummaryByKey(sessionsForTask, sessionValue),
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
          nextSessionIdentity: null,
          nextRole,
          updateQuery,
          scheduleSelectionIntent,
        });
        return;
      }

      const session = findSessionByValue(sessionValue);
      if (!session) {
        return;
      }

      applySelectionIntent({
        nextTaskId: session.taskId,
        nextSessionIdentity: session,
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
      if (!selectedSession) {
        return;
      }

      applySelectionIntent({
        nextTaskId: selectedSession.taskId,
        nextSessionIdentity: selectedSession,
        nextRole: selectedSession.role,
        updateQuery,
        scheduleSelectionIntent,
      });
    },
    [findSessionByValue, scheduleSelectionIntent, taskId, updateQuery],
  );

  const handlePrepareMessageFirstSession = useCallback(
    (option: SessionCreateOption): void => {
      if (!canPrepareMessageFirstSession(option)) {
        return;
      }

      applySelectionIntent({
        nextTaskId: taskId,
        nextSessionIdentity: null,
        nextRole: option.role,
        updateQuery,
        scheduleSelectionIntent,
      });
    },
    [canPrepareMessageFirstSession, scheduleSelectionIntent, taskId, updateQuery],
  );

  return {
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handlePrepareMessageFirstSession,
  };
}
