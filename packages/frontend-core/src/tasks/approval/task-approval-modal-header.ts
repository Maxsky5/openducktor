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
      title: "Builder Worktree Missing",
      description:
        "OpenDucktor cannot find the builder worktree, so Direct Merge and Pull Request are not available. Close the task without a merge, or reset the implementation to send the task back for more work.",
    };
  }

  if (model.stage === "complete_direct_merge" && model.publishTarget !== null) {
    const publishTargetLabel = canonicalTargetBranch(model.publishTarget);
    return {
      title: "Publish And Mark Done",
      description: `The local merge is already applied. Push ${publishTargetLabel} to publish it, then move the task to Done.`,
    };
  }

  if (model.stage === "complete_direct_merge") {
    return {
      title: "Complete Direct Merge",
      description:
        "The local merge is already applied. Finish the direct merge workflow to move the task to Done.",
    };
  }

  // The approval choices name what the user can do, so the stage needs no description.
  return { title: "Approve Task", description: null };
}
