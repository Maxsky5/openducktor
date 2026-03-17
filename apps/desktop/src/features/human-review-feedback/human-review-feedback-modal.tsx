import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send Human Feedback</DialogTitle>
          <DialogDescription>
            Choose which builder session should receive this feedback, or start a new one, then edit
            the message that will be sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label htmlFor="human-review-feedback-target">Builder Session</Label>
            <Combobox
              value={model.selectedTarget}
              options={model.targetOptions}
              disabled={model.isSubmitting}
              placeholder="Select builder session"
              searchPlaceholder="Search builder session..."
              onValueChange={model.onTargetChange}
              triggerClassName="h-11"
            />
          </div>

          <div className="space-y-2">
            <Label>Your feedback (will be sent as a message to the Builder agent)</Label>
            <Textarea
              id="human-review-feedback-message"
              value={model.message}
              disabled={model.isSubmitting}
              className="min-h-48"
              onChange={(event) => model.onMessageChange(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={model.isSubmitting}
            onClick={() => model.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={confirmDisabled} onClick={model.onConfirm}>
            {model.selectedTarget === "new_session" ? "Continue" : "Send Feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
