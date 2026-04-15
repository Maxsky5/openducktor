import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HumanReviewFeedbackHydrationFollowup,
  PrepareHumanReviewFeedbackResult,
} from "./human-review-feedback-flow";
import type { HumanReviewFeedbackState } from "./human-review-feedback-types";

const hasBuilderSessionOptions = (state: HumanReviewFeedbackState): boolean => {
  return state.builderSessions.length > 0;
};

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
  const openRequestIdRef = useRef(0);
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

    const nextState = createStateRef.current(hydrationFollowup.taskId);
    if (!hasBuilderSessionOptions(nextState)) {
      return;
    }

    setHumanReviewFeedbackState((current) => {
      if (!current || current.taskId !== hydrationFollowup.taskId) {
        return nextState;
      }

      return {
        ...nextState,
        message: current.message,
      };
    });
    setHydrationFollowup(null);
  }, [hydrationFollowup, sessions]);

  const clearHumanReviewFeedback = useCallback((): void => {
    openRequestIdRef.current += 1;
    setHydrationFollowup(null);
    setHumanReviewFeedbackState(null);
  }, []);

  const openHumanReviewFeedback = useCallback(
    (taskId: string): void => {
      const requestId = ++openRequestIdRef.current;
      void (async () => {
        try {
          const result = await openFeedbackRef.current(taskId);
          if (requestId !== openRequestIdRef.current) {
            return;
          }

          if (result.kind === "failed") {
            clearHumanReviewFeedback();
            return;
          }

          setHumanReviewFeedbackState(result.state);
          setHydrationFollowup(
            result.kind === "ready_with_followup" ? result.hydrationFollowup : null,
          );
        } catch {
          if (requestId === openRequestIdRef.current) {
            clearHumanReviewFeedback();
          }
        }
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
