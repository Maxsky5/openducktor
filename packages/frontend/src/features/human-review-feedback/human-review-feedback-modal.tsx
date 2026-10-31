import { LoaderCircle, MessageSquareWarning } from "lucide-react";
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
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogHeader className="px-6 py-5 pr-14">
          <DialogTitle>{HUMAN_REVIEW_FEEDBACK_COPY.title}</DialogTitle>
          <DialogDescription>{HUMAN_REVIEW_FEEDBACK_COPY.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 overflow-y-auto px-6 pb-6">
          <div className="flex flex-col gap-2">
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

        <DialogFooter className="mt-0 justify-between border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={model.isSubmitting}
            onClick={() => model.onOpenChange(false)}
          >
            {HUMAN_REVIEW_FEEDBACK_COPY.cancelLabel}
          </Button>
          <Button
            type="button"
            aria-busy={model.isSubmitting}
            disabled={confirmDisabled}
            onClick={() => void model.onConfirm()}
          >
            {model.isSubmitting ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <MessageSquareWarning data-icon="inline-start" />
            )}
            {HUMAN_REVIEW_FEEDBACK_COPY.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
