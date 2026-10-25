import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useEffect,
  useState,
} from "react";
import { Modal, Pressable, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { ModalFeedbackHost } from "@/feedback/feedback-host";
import { sansWeight } from "@/theme/tokens";
import { Button } from "./button";
import { createQuestionSlot } from "./confirm-question";
import { Text } from "./text";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  /** The label of the choice that keeps things as they are. */
  cancelLabel?: string | undefined;
  destructive?: boolean | undefined;
};

/** Asks the user to confirm. It resolves true only when the user confirms. */
export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/** The confirmation of the current screen. */
export const useConfirm = (): Confirm => {
  const confirm = use(ConfirmContext);
  if (!confirm) throw new Error("A confirmation needs the ConfirmDialogHost of its screen.");
  return confirm;
};

/**
 * Hosts the confirmation dialog of one screen. Each navigator wraps its screens in a host, so the
 * dialog opens over the screen that asks, also over a form sheet. A new question answers an open
 * one with false, and so does a screen that closes.
 */
export function ConfirmDialogHost({ children }: PropsWithChildren): ReactElement {
  const [question, setQuestion] = useState<ConfirmOptions | null>(null);
  const [slot] = useState(() => createQuestionSlot<ConfirmOptions>(setQuestion));
  const { answer } = slot;
  useEffect(() => slot.dispose, [slot]);
  return (
    <ConfirmContext value={slot.ask}>
      {children}
      <Modal
        visible={question !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => answer(false)}
      >
        {/* A modal is its own native window, so its buttons need their own gesture root. */}
        <GestureHandlerRootView style={styles.fill}>
          {/* A closing dialog gives its toasts back to the root at once, so they do not fade out
              with its window. */}
          {question ? (
            <>
              <ConfirmDialog question={question} onAnswer={answer} />
              <ModalFeedbackHost />
            </>
          ) : null}
        </GestureHandlerRootView>
      </Modal>
    </ConfirmContext>
  );
}

/**
 * The desktop dialog: a popover card with an outline and a shadow over a dim backdrop, the title,
 * the message, then Cancel and the action. A tap outside the card cancels.
 */
function ConfirmDialog({
  question,
  onAnswer,
}: {
  question: ConfirmOptions;
  onAnswer: (confirmed: boolean) => void;
}): ReactElement {
  return (
    <View style={styles.root}>
      <Pressable
        style={styles.backdrop}
        onPress={() => onAnswer(false)}
        accessibilityRole="button"
        accessibilityLabel={question.cancelLabel ?? "Cancel"}
      />
      <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
        <Text accessibilityRole="header" style={styles.title}>
          {question.title}
        </Text>
        <Text style={styles.message}>{question.message}</Text>
        <View style={styles.footer}>
          <View style={styles.action}>
            <Button
              label={question.cancelLabel ?? "Cancel"}
              variant="outline"
              onPress={() => onAnswer(false)}
              fill
            />
          </View>
          <View style={styles.action}>
            <Button
              label={question.confirmLabel}
              variant={question.destructive ? "destructive" : "filled"}
              onPress={() => onAnswer(true)}
              fill
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.space.xxl },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.scrim,
  },
  // `max-w-md rounded-xl border bg-popover p-6 shadow-xl`, as the desktop dialog.
  card: {
    width: "100%",
    maxWidth: 448,
    gap: 6,
    padding: theme.space.xxl,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.popover,
    boxShadow: theme.shadows.overlay,
  },
  title: {
    ...sansWeight("semibold"),
    fontSize: 18,
    lineHeight: 26,
    color: theme.desktop.foreground,
  },
  message: { fontSize: 14, lineHeight: 20, color: theme.desktop.mutedForeground },
  // Cancel on the left and the action on the right, as the form footers. Two long labels that do
  // not fit side by side stack, each at full width.
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.space.sm,
    marginTop: theme.space.lg,
  },
  action: { flexGrow: 1 },
}));
