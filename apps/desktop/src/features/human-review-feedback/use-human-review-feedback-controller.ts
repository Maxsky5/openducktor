import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HumanReviewFeedbackHydrationFollowup,
  PrepareHumanReviewFeedbackResult,
} from "./human-review-feedback-flow";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

type UseHumanReviewFeedbackControllerArgs = {
  sessions: readonly unknown[];
  createState: (taskId: string) => HumanReviewFeedbackState;
  openFeedback: (taskId: string) => Promise<PrepareHumanReviewFeedbackResult>;
};

type UseHumanReviewFeedbackControllerResult = {
  humanReviewFeedbackState: HumanReviewFeedbackState | null;
  setHumanReviewFeedbackState: Dispatch<SetStateAction<HumanReviewFeedbackState | null>>;
  openHumanReviewFeedback: (taskId: string) => void;
  clearHumanReviewFeedback: () => void;
};

export const useHumanReviewFeedbackController = ({
  sessions,
  createState,
  openFeedback,
}: UseHumanReviewFeedbackControllerArgs): UseHumanReviewFeedbackControllerResult => {
  const createStateRef = useRef(createState);
  const openFeedbackRef = useRef(openFeedback);
  const [humanReviewFeedbackState, setHumanReviewFeedbackState] =
    useState<HumanReviewFeedbackState | null>(null);
  const [hydrationFollowup, setHydrationFollowup] =
    useState<HumanReviewFeedbackHydrationFollowup | null>(null);

  createStateRef.current = createState;
  openFeedbackRef.current = openFeedback;

  useEffect(() => {
    if (!hydrationFollowup) {
      return;
    }
    if (sessions === hydrationFollowup.baselineSessions) {
      return;
    }

    setHumanReviewFeedbackState(createStateRef.current(hydrationFollowup.taskId));
    setHydrationFollowup(null);
  }, [hydrationFollowup, sessions]);

  const clearHumanReviewFeedback = useCallback((): void => {
    setHydrationFollowup(null);
    setHumanReviewFeedbackState(null);
  }, []);

  const openHumanReviewFeedback = useCallback(
    (taskId: string): void => {
      void (async () => {
        const result = await openFeedbackRef.current(taskId);
        if (result.kind === "failed") {
          clearHumanReviewFeedback();
          return;
        }

        setHumanReviewFeedbackState(result.state);
        setHydrationFollowup(
          result.kind === "ready_with_followup" ? result.hydrationFollowup : null,
        );
      })();
    },
    [clearHumanReviewFeedback],
  );

  return {
    humanReviewFeedbackState,
    setHumanReviewFeedbackState,
    openHumanReviewFeedback,
    clearHumanReviewFeedback,
  };
};
