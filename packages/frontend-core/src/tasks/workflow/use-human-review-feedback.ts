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
  HumanReviewFeedbackRequest,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";

type UseHumanReviewFeedbackArgs = {
  /** The tasks that the form can open for. */
  tasks: readonly TaskCard[];
  scope: WorkspaceRef | null;
  feedback: ClientFeedback;
  /** The sessions whose role session a feedback launch can reuse. */
  sessions: readonly AgentSessionSummary[];
  startSession: (
    request: HumanReviewFeedbackStartRequest,
  ) => Promise<AgentSessionIdentity | undefined>;
};

export type HumanReviewFeedback = {
  modal: HumanReviewFeedbackModalModel | null;
  /** Opens the form of a feedback launch, or of Request Changes with its following launches. */
  open: (taskId: string, request: HumanReviewFeedbackRequest) => void;
  /** Opens the form of a feedback launch of a task that the task list does not hold yet. */
  openForTask: (task: TaskCard, launchActionId: string) => void;
};

/**
 * The one human feedback form of every client. Request Changes with a following launch starts that
 * launch, and the host commits the change only after the launch passes its checks. A canceled
 * start keeps the form, its message, and the task state.
 */
export function useHumanReviewFeedback({
  tasks,
  scope,
  feedback,
  sessions,
  startSession,
}: UseHumanReviewFeedbackArgs): HumanReviewFeedback {
  const queryClient = useQueryClient();
  const tasksRef = useRef(tasks);
  useLayoutEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const [state, setState] = useState<HumanReviewFeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const open = useCallback<HumanReviewFeedback["open"]>(
    (taskId, request) =>
      setState(createHumanReviewFeedbackState(tasksRef.current, taskId, request)),
    [],
  );
  const openForTask = useCallback<HumanReviewFeedback["openForTask"]>(
    (task, launchActionId) =>
      setState(createHumanReviewFeedbackState([task], task.id, { kind: "launch", launchActionId })),
    [],
  );

  const confirm = useCallback(async (): Promise<void> => {
    if (!state) return;
    setIsSubmitting(true);
    try {
      const { launch } = state;
      const result = await submitHumanReviewFeedback({
        feedback,
        state,
        requestChangesTask: (taskId, note) =>
          requestHumanReviewChanges(queryClient, scope, taskId, note),
        builderSessions: launch
          ? sessions
              .filter(({ taskId, role }) => taskId === state.taskId && role === launch.role)
              .toSorted(compareAgentSessionRecency)
          : [],
        startRequestChangesSession: startSession,
      });
      if (result.outcome !== "cancelled") setState(null);
    } catch (cause) {
      feedback.show("error", "Failed to submit feedback.", { description: errorMessage(cause) });
    } finally {
      setIsSubmitting(false);
    }
  }, [state, feedback, queryClient, scope, sessions, startSession]);

  const modal = useMemo(
    () =>
      state
        ? buildHumanReviewFeedbackModalModel({
            state,
            isSubmitting,
            onDismiss: () => {
              if (!isSubmitting) setState(null);
            },
            onMessageChange: (message) =>
              setState((current) => (current ? { ...current, message } : current)),
            onConfirm: confirm,
          })
        : null,
    [state, isSubmitting, confirm],
  );

  return { modal, open, openForTask };
}
