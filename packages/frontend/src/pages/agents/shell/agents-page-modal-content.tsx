import type { ComponentProps, ReactElement } from "react";
import { SessionStartModal } from "@/components/features/agents/session-start-modal";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import { TaskDetailsSheetController } from "@/components/features/task-details/task-details-sheet-controller";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import type { AgentStudioPullRequestModalModel } from "./use-agent-studio-pull-request-modal-model";
import type { AgentStudioTaskDetailsLauncherModel } from "./use-agent-studio-task-details-launcher";

export type AgentsPageModalContentModel = {
  mergedPullRequestModal: AgentStudioPullRequestModalModel | null;
  humanReviewFeedbackModal: ComponentProps<typeof HumanReviewFeedbackModal>["model"];
  sessionStartModal: ComponentProps<typeof SessionStartModal>["model"] | null;
  taskDetailsLauncher: AgentStudioTaskDetailsLauncherModel;
};

export function AgentsPageModalContent({
  model,
}: {
  model: AgentsPageModalContentModel;
}): ReactElement {
  const {
    mergedPullRequestModal,
    humanReviewFeedbackModal,
    sessionStartModal,
    taskDetailsLauncher,
  } = model;

  return (
    <>
      {mergedPullRequestModal ? (
        <MergedPullRequestConfirmDialog {...mergedPullRequestModal} />
      ) : null}
      <HumanReviewFeedbackModal model={humanReviewFeedbackModal} />
      {sessionStartModal ? <SessionStartModal model={sessionStartModal} /> : null}
      <TaskDetailsSheetController
        ref={taskDetailsLauncher.taskDetailsSheetRef}
        {...taskDetailsLauncher.taskDetailsSheetProps}
      />
    </>
  );
}
