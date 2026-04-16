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
import type { HumanReviewFeedbackModalModel } from "./human-review-feedback-types";

export function HumanReviewFeedbackModal({
  model,
}: {
  model: HumanReviewFeedbackModalModel | null;
}): ReactElement | null {
  if (!model) {
    return null;
  }

  const confirmDisabled = model.isSubmitting || model.message.trim().length === 0;

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
          <DialogTitle>Send Human Feedback</DialogTitle>
          <DialogDescription>
            Describe the changes you want the Builder to make. The next step will use the standard
            session-start flow to choose whether to reuse an existing Builder session or start a new
            one.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6 overflow-visible pt-2 pb-4">
          <div className="space-y-3">
            <Label htmlFor="human-review-feedback-message">Your feedback</Label>
            <Textarea
              id="human-review-feedback-message"
              value={model.message}
              disabled={model.isSubmitting}
              className="min-h-48"
              placeholder="Describe the changes you want the Builder to make."
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
            Cancel
          </Button>
          <Button type="button" disabled={confirmDisabled} onClick={() => void model.onConfirm()}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
