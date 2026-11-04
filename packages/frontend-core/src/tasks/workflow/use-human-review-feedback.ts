import type { WorkspaceRef } from "@openducktor/contracts";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compareAgentSessionRecency } from "../../lib/agent-session-options";
import { errorMessage } from "../../lib/errors";
import type { ClientFeedback } from "../../platform/client-feedback";
import type { AgentSessionSummary } from "../../sessions/agent-sessions-store";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import {
  type HumanReviewFeedbackStartRequest,
  requestHumanReviewChanges,
  submitHumanReviewFeedback,
} from "./human-review-feedback-flow";
import {
  buildHumanReviewFeedbackModalModel,
  createHumanReviewFeedbackState,
} from "./human-review-feedback-state";
import type {
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";
import type { ContinueTaskWorkflow, TaskWorkflowContinuation } from "./task-workflow-continuation";

/** The open feedback form of a client. */
export type HumanReviewFeedbackStateApi = {
  state: HumanReviewFeedbackState | null;
  /** Opens the form of a feedback launch, or of Request Changes with its continuation. */
  open: (
    taskId: string,
    launchActionId?: string,
    requestChanges?: boolean,
    continuation?: TaskWorkflowContinuation,
  ) => void;
  /** Opens the form of a feedback launch of a task that the task list does not hold yet. */
  openForTask: (task: TaskCard, launchActionId: string) => void;
  setMessage: (message: string) => void;
  close: () => void;
};

/**
 * The state of the one human feedback form. A launch can open it before its submission exists,
 * because Request Changes continues into launches that can open the form again.
 */
export function useHumanReviewFeedbackState(
  tasks: readonly TaskCard[],
): HumanReviewFeedbackStateApi {
  const tasksRef = useRef(tasks);
  useLayoutEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const [state, setState] = useState<HumanReviewFeedbackState | null>(null);
  const open = useCallback<HumanReviewFeedbackStateApi["open"]>(
    (taskId, launchActionId, requestChanges, continuation) =>
      setState(
        createHumanReviewFeedbackState(
          [...tasksRef.current],
          taskId,
          launchActionId,
          requestChanges,
          continuation,
        ),
      ),
    [],
  );
  const openForTask = useCallback<HumanReviewFeedbackStateApi["openForTask"]>(
    (task, launchActionId) =>
      setState(createHumanReviewFeedbackState([task], task.id, launchActionId)),
    [],
  );
  const setMessage = useCallback(
    (message: string) => setState((current) => (current ? { ...current, message } : current)),
    [],
  );
  const close = useCallback(() => setState(null), []);
  return useMemo(
    () => ({ state, open, openForTask, setMessage, close }),
    [state, open, openForTask, setMessage, close],
  );
}

type UseHumanReviewFeedbackFormArgs = {
  scope: WorkspaceRef | null;
  feedback: ClientFeedback;
  /** The sessions whose role session a feedback launch can reuse. */
  sessions: readonly AgentSessionSummary[];
  /** Without it, Request Changes cannot start a declared following launch. */
  continueTaskWorkflow?: ContinueTaskWorkflow | undefined;
  startSession: (
    request: HumanReviewFeedbackStartRequest,
  ) => Promise<AgentSessionIdentity | undefined>;
};

/**
 * The submission and modal model of the one human feedback form. Request Changes runs its host
 * command, and a feedback launch starts its role session.
 */
export function useHumanReviewFeedbackForm(
  form: HumanReviewFeedbackStateApi,
  { scope, feedback, sessions, continueTaskWorkflow, startSession }: UseHumanReviewFeedbackFormArgs,
): HumanReviewFeedbackModalModel | null {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { state, close, setMessage } = form;

  const confirm = useCallback(async (): Promise<void> => {
    if (!state) return;
    setIsSubmitting(true);
    try {
      const { launch } = state;
      const result = await submitHumanReviewFeedback({
        feedback,
        state,
        continueTaskWorkflow,
        requestChangesTask: (taskId, note) =>
          requestHumanReviewChanges(queryClient, scope, taskId, note),
        builderSessions: launch
          ? sessions
              .filter(({ taskId, role }) => taskId === state.taskId && role === launch.role)
              .toSorted(compareAgentSessionRecency)
          : [],
        startRequestChangesSession: startSession,
      });
      if (result.outcome !== "cancelled") close();
    } catch (cause) {
      feedback.show("error", "Failed to submit feedback.", { description: errorMessage(cause) });
    } finally {
      setIsSubmitting(false);
    }
  }, [state, feedback, continueTaskWorkflow, queryClient, scope, sessions, startSession, close]);

  return useMemo(
    () =>
      state
        ? buildHumanReviewFeedbackModalModel({
            state,
            isSubmitting,
            onDismiss: () => {
              if (!isSubmitting) close();
            },
            onMessageChange: setMessage,
            onConfirm: confirm,
          })
        : null,
    [state, isSubmitting, confirm, close, setMessage],
  );
}
