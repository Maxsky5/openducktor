import { canonicalTargetBranch } from "@/lib/target-branch";
import type { TaskApprovalModalModel } from "./kanban-page-model-types";

export function getTaskApprovalModalHeader(model: TaskApprovalModalModel): {
  title: string;
  description: string;
} {
  if (model.stage === "missing_builder_worktree") {
    return {
      title: "Builder Worktree Missing",
      description:
        "The builder worktree for this task is no longer available. You can still complete the task or reset the implementation from here.",
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
        "The local merge is already applied. Finish the direct merge workflow to move the task to Done and clean up the builder workspace.",
    };
  }

  return {
    title: "Approve Task",
    description:
      "Choose how to finish this task: merge it locally now, or create and update a pull request.",
  };
}
