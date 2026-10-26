import { type ComponentProps, type ReactElement, useEffect, useEffectEvent } from "react";
import {
  useSessionViewActive,
  useSessionViewShown,
} from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { SessionStartModal } from "@/components/features/agents/session-start-modal";
import { MergedPullRequestConfirmDialog } from "@/components/features/pull-requests/merged-pull-request-confirm-dialog";
import { HumanReviewFeedbackModal } from "@/features/human-review-feedback/human-review-feedback-modal";
import type { AgentStudioPullRequestModalModel } from "./use-agent-studio-pull-request-modal-model";

export type AgentsPageModalContentModel = {
  mergedPullRequestModal: AgentStudioPullRequestModalModel | null;
  humanReviewFeedbackModal: ComponentProps<typeof HumanReviewFeedbackModal>["model"];
  sessionStartModal: ComponentProps<typeof SessionStartModal>["model"] | null;
};

type AgentsPageModalContentProps = {
  model: AgentsPageModalContentModel;
};

export function AgentsPageModalContent({ model }: AgentsPageModalContentProps): ReactElement {
  const { mergedPullRequestModal, humanReviewFeedbackModal, sessionStartModal } = model;
  // Modal portals sit outside the hidden page, so a view that leaves the screen closes them.
  const isShown = useSessionViewShown();
  const isActive = useSessionViewActive();
  const close = useEffectEvent(() => {
    mergedPullRequestModal?.onCancel();
    humanReviewFeedbackModal?.onOpenChange(false);
    sessionStartModal?.onOpenChange(false);
  });
  useEffect(() => {
    if (!isShown) close();
  }, [
    isShown,
    mergedPullRequestModal?.taskId,
    humanReviewFeedbackModal?.open,
    sessionStartModal?.open,
  ]);
  if (!isShown || !isActive) return <></>;

  return (
    <>
      {mergedPullRequestModal ? (
        <MergedPullRequestConfirmDialog {...mergedPullRequestModal} />
      ) : null}
      <HumanReviewFeedbackModal model={humanReviewFeedbackModal} />
      {sessionStartModal ? <SessionStartModal model={sessionStartModal} /> : null}
    </>
  );
}
