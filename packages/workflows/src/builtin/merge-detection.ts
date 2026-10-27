import { activeOrReview } from "./definition-conditions";

const candidateStatuses: ReadonlySet<string> = new Set(activeOrReview.stateIn);

/** Merge detection checks only tasks with work in progress or in review. */
export const isMergeDetectionCandidateStatus = (status: string): boolean =>
  candidateStatuses.has(status);
