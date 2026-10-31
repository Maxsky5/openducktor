import { useContext, type ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { HUMAN_REVIEW_FEEDBACK_COPY as COPY } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-state";
import { TextField, type TextFieldProps } from "@/ui/fields";
import { ModalLoadingContext } from "@/ui/modal-loading-context";

export function RequestChangesFeedbackField(
  props: Pick<TextFieldProps, "value" | "onChangeText" | "editable">,
): ReactElement | null {
  const loading = useContext(ModalLoadingContext);
  if (loading) return null;
  return (
    <TextField
      {...props}
      label={COPY.messageLabel}
      placeholder={COPY.messagePlaceholder}
      autoFocus
      multiline
      style={styles.message}
    />
  );
}

const styles = StyleSheet.create({
  message: { minHeight: 192, maxHeight: 360, textAlignVertical: "top" },
});
