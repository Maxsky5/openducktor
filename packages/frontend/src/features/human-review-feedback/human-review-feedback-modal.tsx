import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import {
  HUMAN_REVIEW_FEEDBACK_COPY,
  isHumanReviewFeedbackConfirmDisabled,
} from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-state";

export function HumanReviewFeedbackModal({
  model,
}: {
  model: HumanReviewFeedbackModalModel | null;
}): ReactElement | null {
  if (!model) {
    return null;
  }

  const confirmDisabled = isHumanReviewFeedbackConfirmDisabled(model);

  return (
    <Dialog
      open={model.open}
      onOpenChange={(nextOpen) => {
        if (!model.isSubmitting) {
          model.onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="max-w-2xl overflow-visible">
        <DialogHeader>
          <DialogTitle>{HUMAN_REVIEW_FEEDBACK_COPY.title}</DialogTitle>
          <DialogDescription>{HUMAN_REVIEW_FEEDBACK_COPY.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6 overflow-visible pt-2 pb-4">
          <div className="space-y-3">
            <Label htmlFor="human-review-feedback-message">
              {HUMAN_REVIEW_FEEDBACK_COPY.messageLabel}
            </Label>
            <Textarea
              id="human-review-feedback-message"
              value={model.message}
              disabled={model.isSubmitting}
              className="min-h-48"
              placeholder={HUMAN_REVIEW_FEEDBACK_COPY.messagePlaceholder}
              onChange={(event) => model.onMessageChange(event.target.value)}
            />
          </div>
        </DialogBody>

        <DialogFooter className="mt-0 justify-between border-t border-border pt-6">
          <Button
            type="button"
            variant="outline"
            disabled={model.isSubmitting}
            onClick={() => model.onOpenChange(false)}
          >
            {HUMAN_REVIEW_FEEDBACK_COPY.cancelLabel}
          </Button>
          <Button type="button" disabled={confirmDisabled} onClick={() => void model.onConfirm()}>
            {HUMAN_REVIEW_FEEDBACK_COPY.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
