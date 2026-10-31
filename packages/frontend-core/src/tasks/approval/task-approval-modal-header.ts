import { canonicalTargetBranch } from "../../lib/target-branch";
import type { TaskApprovalModalModel } from "./task-approval-types";

type TaskApprovalModalHeader = {
  title: string;
  /** What the stage needs from the user. Null when its choices tell it. */
  description: string | null;
};

export function getTaskApprovalModalHeader(model: TaskApprovalModalModel): TaskApprovalModalHeader {
  if (model.stage === "missing_builder_worktree") {
    return {
      title: "Builder worktree missing",
      description:
        "The Builder worktree is gone. Close the task without a merge, or reset the implementation to build it again.",
    };
  }

  if (model.stage === "complete_direct_merge" && model.publishTarget !== null) {
    const publishTargetLabel = canonicalTargetBranch(model.publishTarget);
    return {
      title: "Publish and mark done",
      description: `The local merge is already applied. Push ${publishTargetLabel} to publish it, then move the task to Done.`,
    };
  }

  if (model.stage === "complete_direct_merge") {
    return {
      title: "Complete direct merge",
      description: "The local merge is ready. Mark the task as Done to finish.",
    };
  }

  // The approval choices name what the user can do, so the stage needs no description.
  return { title: "Approve task", description: null };
}
