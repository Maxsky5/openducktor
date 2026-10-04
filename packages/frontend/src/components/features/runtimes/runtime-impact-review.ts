import type { RuntimeKind, RuntimeLifecycleImpact } from "@openducktor/contracts";
import { useCallback, useRef, useState } from "react";
import { useRuntimeImpactWatch } from "./runtime-impact-watch";

/** Shown when the live sessions changed after the user reviewed the impact. */
export const RUNTIME_IMPACT_CHANGED_NOTICE =
  "The affected sessions changed. Review the updated list, then confirm again.";

/** True when the action stops at least one live session. */
export const hasLiveSessions = (impact: RuntimeLifecycleImpact): boolean =>
  impact.workspaces.some((workspace) => workspace.sessions.length > 0);

export type RuntimeImpactActionResult =
  | { type: "completed" }
  /** The host rejected the confirmation. The review shows the new impact and asks again. */
  | { type: "impact_changed"; impact: RuntimeLifecycleImpact }
  /** The review stays open and shows the error. */
  | { type: "failed"; error: string };

/** Runs the lifecycle action with the confirmation of the reviewed impact. */
export type RuntimeImpactAction = (
  impact: RuntimeLifecycleImpact,
) => Promise<RuntimeImpactActionResult>;

export type RuntimeImpactReviewRequest = {
  readImpact: () => Promise<RuntimeLifecycleImpact>;
  run: RuntimeImpactAction;
  /** Explains why the review opened. */
  notice?: string | null;
};

/** An open review of the live sessions that a lifecycle action stops. */
export type RuntimeImpactReviewState = {
  impact: RuntimeLifecycleImpact | null;
  isLoadingImpact: boolean;
  impactError: string | null;
  /** Explains why the review opened, or why it asks again. */
  notice: string | null;
  isPending: boolean;
  /** A failed lifecycle action. */
  error: string | null;
};

export type RuntimeImpactReview = {
  /** Null while no review is open. */
  review: RuntimeImpactReviewState | null;
  /**
   * Opens a new review. Confirm runs the action with the current impact. The promise resolves
   * true when the action completes and false on cancel. It rejects when the action throws, and
   * the review then closes.
   */
  open: (request: RuntimeImpactReviewRequest) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
};

type OpenReview = {
  key: number;
  readImpact: () => Promise<RuntimeLifecycleImpact>;
  notice: string | null;
  isPending: boolean;
  error: string | null;
};

type ReviewDecision = {
  run: RuntimeImpactAction;
  /** The action runs. A second confirm waits for its result. */
  isRunning: boolean;
  resolve: (completed: boolean) => void;
  reject: (cause: unknown) => void;
};

/**
 * Reviews the live sessions that a lifecycle action stops, then runs the action. The impact stays
 * current through host runtime events while the review is open. Only a current impact read can
 * confirm. The host checks the confirmation again.
 */
export const useRuntimeImpactReview = ({
  kinds,
}: {
  kinds: ReadonlyArray<RuntimeKind>;
}): RuntimeImpactReview => {
  const [openReview, setOpenReview] = useState<OpenReview | null>(null);
  const reviewKeyRef = useRef(0);
  // The decision of the open review. Results of a closed review change nothing.
  const decisionRef = useRef<ReviewDecision | null>(null);
  const watch = useRuntimeImpactWatch({
    reviewKey: openReview?.key ?? null,
    kinds,
    readImpact: () => {
      if (openReview === null) throw new Error("No runtime review is open.");
      return openReview.readImpact();
    },
  });
  const { replace } = watch;
  const currentImpact = watch.isLoading || watch.error !== null ? null : watch.impact;

  const close = useCallback((decision: ReviewDecision): void => {
    if (decisionRef.current !== decision) return;
    decisionRef.current = null;
    setOpenReview(null);
  }, []);

  const open = useCallback(
    ({ readImpact, run, notice = null }: RuntimeImpactReviewRequest): Promise<boolean> => {
      const { promise, resolve, reject } = Promise.withResolvers<boolean>();
      // A new review replaces an open one. The earlier review ends as canceled.
      decisionRef.current?.resolve(false);
      decisionRef.current = { run, isRunning: false, resolve, reject };
      reviewKeyRef.current += 1;
      setOpenReview({
        key: reviewKeyRef.current,
        readImpact,
        notice,
        isPending: false,
        error: null,
      });
      return promise;
    },
    [],
  );

  const confirm = useCallback((): void => {
    const decision = decisionRef.current;
    if (decision === null || decision.isRunning || currentImpact === null) return;
    decision.isRunning = true;
    setOpenReview((current) => current && { ...current, isPending: true, error: null });
    decision.run(currentImpact).then(
      (result) => {
        if (result.type === "completed") {
          close(decision);
          decision.resolve(true);
          return;
        }
        decision.isRunning = false;
        if (decisionRef.current !== decision) return;
        if (result.type === "impact_changed") {
          replace(result.impact);
          setOpenReview(
            (current) =>
              current && { ...current, notice: RUNTIME_IMPACT_CHANGED_NOTICE, isPending: false },
          );
          return;
        }
        setOpenReview(
          (current) => current && { ...current, isPending: false, error: result.error },
        );
      },
      (cause: unknown) => {
        close(decision);
        decision.reject(cause);
      },
    );
  }, [close, currentImpact, replace]);

  const cancel = useCallback((): void => {
    const decision = decisionRef.current;
    if (decision === null) return;
    close(decision);
    decision.resolve(false);
  }, [close]);

  return {
    review:
      openReview === null
        ? null
        : {
            impact: watch.impact,
            isLoadingImpact: watch.isLoading,
            impactError: watch.error,
            notice: openReview.notice,
            isPending: openReview.isPending,
            error: openReview.error,
          },
    open,
    confirm,
    cancel,
  };
};
