import type { TaskWorkflowContinuation } from "./task-workflow-continuation";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

type UseHumanReviewFeedbackControllerArgs = {
  createState: (
    taskId: string,
    launchActionId?: string,
    requestChangesBeforeStart?: boolean,
    continuation?: TaskWorkflowContinuation,
  ) => HumanReviewFeedbackState;
};

type UseHumanReviewFeedbackControllerResult = {
  humanReviewFeedbackState: HumanReviewFeedbackState | null;
  setHumanReviewFeedbackState: Dispatch<SetStateAction<HumanReviewFeedbackState | null>>;
  openHumanReviewFeedback: (
    taskId: string,
    launchActionId?: string,
    requestChangesBeforeStart?: boolean,
    continuation?: TaskWorkflowContinuation,
  ) => void;
  clearHumanReviewFeedback: () => void;
};

export const useHumanReviewFeedbackController = ({
  createState,
}: UseHumanReviewFeedbackControllerArgs): UseHumanReviewFeedbackControllerResult => {
  const createStateRef = useRef(createState);
  const [humanReviewFeedbackState, setHumanReviewFeedbackState] =
    useState<HumanReviewFeedbackState | null>(null);

  useLayoutEffect(() => {
    createStateRef.current = createState;
  }, [createState]);

  const clearHumanReviewFeedback = useCallback((): void => {
    setHumanReviewFeedbackState(null);
  }, []);

  const openHumanReviewFeedback = useCallback(
    (
      taskId: string,
      launchActionId?: string,
      requestChangesBeforeStart?: boolean,
      continuation?: TaskWorkflowContinuation,
    ): void => {
      setHumanReviewFeedbackState(
        createStateRef.current(taskId, launchActionId, requestChangesBeforeStart, continuation),
      );
    },
    [],
  );

  return {
    humanReviewFeedbackState,
    setHumanReviewFeedbackState,
    openHumanReviewFeedback,
    clearHumanReviewFeedback,
  };
};
