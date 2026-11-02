import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sansWeight } from "@/theme/tokens";
import { Button } from "./button";
import { createQuestionSlot } from "./confirm-question";
import type { IconName } from "./icon";
import { Text } from "./text";
import { ModalWindow } from "./modal-window";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  icon: IconName;
  /** The label of the choice that keeps things as they are. */
  cancelLabel?: string | undefined;
  destructive?: boolean | undefined;
};

/** Asks the user to confirm. It resolves true only when the user confirms. */
export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);
const NavigationConfirmContext = createContext<Confirm | null>(null);

/** The confirmation of the current screen. */
export const useConfirm = (): Confirm => {
  const confirm = use(ConfirmContext);
  if (!confirm) throw new Error("A confirmation needs the ConfirmDialogHost of its screen.");
  return confirm;
};

/** A confirmation that can follow the caller to another screen. */
export const useNavigationConfirm = (): Confirm => {
  const confirm = use(NavigationConfirmContext);
  if (!confirm) throw new Error("A navigation confirmation needs the host above its navigator.");
  return confirm;
};

/**
 * Screens own their dialogs so questions open over form sheets. A navigation host keeps a question
 * alive while its caller leaves a screen. Replacing a question or releasing its host answers false.
 */
export function ConfirmDialogHost({
  children,
  scope = "screen",
}: PropsWithChildren<{ scope?: "screen" | "navigation" }>): ReactElement {
  const [question, setQuestion] = useState<ConfirmOptions | null>(null);
  const [slot] = useState(() => createQuestionSlot<ConfirmOptions>(setQuestion));
  const mounted = useRef(true);
  const { answer } = slot;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      slot.dispose();
    };
  }, [slot]);
  const confirm = useCallback<Confirm>(
    (options) => (mounted.current ? slot.ask(options) : Promise.resolve(false)),
    [slot],
  );
  const Context = scope === "navigation" ? NavigationConfirmContext : ConfirmContext;
  return (
    <Context value={confirm}>
      {children}
      <ModalWindow
        visible={question !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => answer(false)}
      >
        {question ? <ConfirmDialog question={question} onAnswer={answer} /> : null}
      </ModalWindow>
    </Context>
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
              icon={question.icon}
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
  footer: {
    flexDirection: "row",
    gap: theme.space.sm,
    marginTop: theme.space.lg,
  },
  action: { flex: 1, flexBasis: 0, minWidth: 0 },
}));
