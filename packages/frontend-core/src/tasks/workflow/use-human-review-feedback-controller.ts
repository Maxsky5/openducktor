import type { Dispatch, SetStateAction } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

type UseHumanReviewFeedbackControllerArgs = {
  createState: (taskId: string) => HumanReviewFeedbackState;
};

type UseHumanReviewFeedbackControllerResult = {
  humanReviewFeedbackState: HumanReviewFeedbackState | null;
  setHumanReviewFeedbackState: Dispatch<SetStateAction<HumanReviewFeedbackState | null>>;
  openHumanReviewFeedback: (taskId: string) => void;
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

  const openHumanReviewFeedback = useCallback((taskId: string): void => {
    setHumanReviewFeedbackState(createStateRef.current(taskId));
  }, []);

  return {
    humanReviewFeedbackState,
    setHumanReviewFeedbackState,
    openHumanReviewFeedback,
    clearHumanReviewFeedback,
  };
};
