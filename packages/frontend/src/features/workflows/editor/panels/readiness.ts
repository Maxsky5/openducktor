import { plural } from "@openducktor/frontend-core/lib/plural";
import type { ProblemLevel } from "../model/canvas-graph";

export type Readiness = {
  /** The worst problem, or null when nothing needs a look. */
  readonly level: ProblemLevel | null;
  readonly title: string;
  readonly detail: string | null;
};

const thingsToCheck = (count: number) => `${count} to check`;

/**
 * "Ready to publish" without problems, the number to check with only warnings, or the number of
 * errors to fix. A published workflow without a draft has nothing to publish.
 */
export const readiness = ({
  errorCount,
  warningCount,
  hasDraft,
}: {
  errorCount: number;
  warningCount: number;
  hasDraft: boolean;
}): Readiness => {
  if (errorCount > 0)
    return {
      level: "error",
      title: `${plural(errorCount, "problem")} to fix`,
      detail:
        warningCount > 0
          ? thingsToCheck(warningCount)
          : `Fix ${errorCount === 1 ? "it" : "them"} to publish.`,
    };
  if (warningCount > 0)
    return {
      level: "warning",
      title: hasDraft ? thingsToCheck(warningCount) : "Published",
      detail: hasDraft ? null : thingsToCheck(warningCount),
    };
  if (hasDraft) return { level: null, title: "Ready to publish", detail: null };
  return { level: null, title: "Published", detail: "Your next change starts a draft." };
};
