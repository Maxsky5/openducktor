import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import {
  HUMAN_REVIEW_FEEDBACK_COPY as COPY,
  isHumanReviewFeedbackConfirmDisabled,
} from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-state";
import { usePreventRemove } from "expo-router";
import { type ReactElement, useEffect, useRef } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import { useConfirmDiscard } from "@/ui/confirm-discard";
import { RequestChangesFeedbackField } from "./request-changes-feedback-field";
import { Text } from "@/ui/text";
import { ActionForm } from "@/ui/action-form";
import { FormBody, FormLead } from "@/ui/form-rows";
import { GroupedSheet } from "@/navigation/grouped-sheet";
import { requestChangesRemove } from "./request-changes-remove";

/**
 * Keeps typed feedback when a sheet or its start form is dismissed. `leaveSheet` closes a sheet
 * whose only step is the feedback form: Cancel then closes the route at once, as Back does, with
 * the form in place during the exit. Without it, Cancel closes the form and the sheet shows its
 * previous step.
 */
export function useFeedbackSheetClose(
  feedback: HumanReviewFeedbackModalModel | null,
  start: SessionStartModalModel | null,
  transferredToBackground = false,
  leaveSheet?: () => void,
) {
  const confirmDiscard = useConfirmDiscard();
  const remove = requestChangesRemove(feedback, start, transferredToBackground);
  const hasUnsentFeedback = remove === "confirm_discard";
  // The removal guard is read through a ref, because the dismiss that lifts it also runs from it.
  const allowRemovalRef = useRef<() => void>(() => {});
  const dismissFeedback = () => {
    if (!leaveSheet) {
      feedback?.onOpenChange(false);
      return;
    }
    allowRemovalRef.current();
    leaveSheet();
  };
  const discardFeedback = () => {
    void confirmDiscard({
      title: "Discard the Feedback?",
      message: "Your feedback is not sent.",
    }).then((confirmed) => {
      if (confirmed) dismissFeedback();
    });
  };
  const preventedRemove = () => {
    if (remove === "back_to_feedback") start?.onOpenChange(false);
    else discardFeedback();
  };
  const allowRemoval = usePreventRemove(remove !== "leave", preventedRemove);
  useEffect(() => {
    allowRemovalRef.current = allowRemoval;
  }, [allowRemoval]);

  return hasUnsentFeedback ? discardFeedback : dismissFeedback;
}

/** The feedback form also serves following launches in the approval sheet. */
export function HumanFeedbackSheet({
  task,
  feedback,
  onClose,
}: {
  task: { id: string; title: string };
  feedback: HumanReviewFeedbackModalModel;
  onClose: () => void;
}): ReactElement {
  const submitBlocked = isHumanReviewFeedbackConfirmDisabled(feedback);
  return (
    <GroupedSheet title={COPY.title} onClose={onClose} closable={!feedback.isSubmitting}>
      <ActionForm
        note={submitBlocked && !feedback.isSubmitting ? "Write your feedback to continue." : null}
        primary={
          <Button
            label={feedback.confirmLabel}
            size="lg"
            loading={feedback.isSubmitting}
            disabled={submitBlocked}
            onPress={() => void feedback.onConfirm()}
            fill
          />
        }
      >
        <FormBody>
          <View style={styles.lead}>
            <FormLead text={COPY.description(feedback.roleLabel)} />
            <Text variant="footnote" tone="secondary" numberOfLines={2}>
              <Text variant="monoSmall" tone="secondary">
                {task.id}
              </Text>
              {`  ${task.title}`}
            </Text>
          </View>
          <RequestChangesFeedbackField
            roleLabel={feedback.roleLabel}
            value={feedback.message}
            onChangeText={feedback.onMessageChange}
            editable={!feedback.isSubmitting}
          />
        </FormBody>
      </ActionForm>
    </GroupedSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  lead: { gap: theme.space.sm },
}));
