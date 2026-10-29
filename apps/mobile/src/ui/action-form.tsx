import {
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useState,
} from "react";
import { View } from "react-native";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useSheetClose } from "@/navigation/sheet-close";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "./button";
import { Text } from "./text";
import { KEYBOARD_DISMISS_ON_DRAG } from "./keyboard-dismiss";
import { useAnnounce } from "./use-announce";
import { useCompactHeight } from "./use-wide-layout";

type FormFooterProps = {
  /** Why the primary action is disabled, or null when it is enabled. */
  note?: string | null | undefined;
  /** The one `filled` button of the form, or null when the form has no action now. */
  primary: ReactNode;
  /** A third action of the form, such as Run in Background. It shows above Cancel. */
  secondary?: ReactNode;
};

/**
 * The footer of a workflow form, as the desktop dialog footer: a top rule, the reason why the
 * primary action is disabled, then Cancel and the primary action side by side. In a sheet, Cancel
 * is the close control of the sheet, so the sheet header shows only its title. The forms show in
 * full sheets, which the keyboard does not resize on iOS or Android, so the footer moves up with
 * the keyboard. A low window, such as a phone in landscape, puts the reason and the actions in one
 * row, so the fields keep the height. `onHeight` reports the footer height, so the content can
 * scroll above it.
 */
export function FormFooter({
  note,
  primary,
  secondary,
  onHeight,
}: FormFooterProps & { onHeight?: ((height: number) => void) | undefined }): ReactElement | null {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const sheet = useSheetClose();
  const compact = useCompactHeight();
  const claimFooter = sheet?.claimFooter;
  // Before the first paint, so the header never shows its own close control for a frame.
  useLayoutEffect(() => claimFooter?.(), [claimFooter]);
  const bottom = Math.max(insets.bottom, compact ? theme.space.sm : theme.space.lg);
  useAnnounce(note);
  if (!sheet && !note && !primary && !secondary) return null;
  const cancel = sheet ? (
    <Button
      label="Cancel"
      variant="outline"
      size="lg"
      disabled={!sheet.closable}
      onPress={sheet.close}
      fill
    />
  ) : null;
  const Bar = compact ? OneRowFooterBar : StackedFooterBar;
  return (
    <KeyboardStickyView
      // The safe area padding goes under the keyboard, so a small gap stays above it.
      offset={{ closed: 0, opened: bottom - theme.space.md }}
    >
      <Bar
        note={note}
        primary={primary}
        secondary={secondary}
        cancel={cancel}
        inSheet={sheet !== null}
        bottom={bottom}
        onHeight={onHeight}
      />
    </KeyboardStickyView>
  );
}

type FooterBarProps = FormFooterProps & {
  /** Cancel in a sheet, which closes it. */
  cancel: ReactNode;
  inSheet: boolean;
  bottom: number;
  onHeight: ((height: number) => void) | undefined;
};

/** The reason on its own line, then the third action, then Cancel and the primary action. */
function StackedFooterBar({
  note,
  primary,
  secondary,
  cancel,
  inSheet,
  bottom,
  onHeight,
}: FooterBarProps): ReactElement {
  return (
    <View
      style={[styles.bar, { paddingBottom: bottom }]}
      onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}
    >
      {note ? (
        <Text
          variant="footnote"
          tone="tertiary"
          style={styles.note}
          accessibilityLiveRegion="polite"
        >
          {note}
        </Text>
      ) : null}
      {inSheet && secondary ? <View style={styles.actions}>{secondary}</View> : null}
      <View style={styles.actions}>
        {cancel ? <View style={styles.action}>{cancel}</View> : secondary}
        {primary ? <View style={styles.action}>{primary}</View> : null}
      </View>
    </View>
  );
}

/** The reason and every action in one row, for a low window such as a phone in landscape. */
function OneRowFooterBar({
  note,
  primary,
  secondary,
  cancel,
  inSheet,
  bottom,
  onHeight,
}: FooterBarProps): ReactElement {
  return (
    <View
      style={[styles.bar, styles.compactBar, { paddingBottom: bottom }]}
      onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)}
    >
      <View style={styles.compactNote}>
        {note ? (
          <Text
            variant="footnote"
            tone="tertiary"
            numberOfLines={2}
            accessibilityLiveRegion="polite"
          >
            {note}
          </Text>
        ) : null}
      </View>
      {inSheet && secondary ? <View style={styles.compactAction}>{secondary}</View> : null}
      {cancel ? <View style={styles.compactAction}>{cancel}</View> : secondary}
      {primary ? <View style={styles.compactAction}>{primary}</View> : null}
    </View>
  );
}

/**
 * A workflow form, as a desktop dialog on a phone: the fields scroll above the `FormFooter`, and
 * the focused field stays above the footer while the keyboard shows.
 */
export function ActionForm({
  note,
  primary,
  secondary,
  scrollRef,
  children,
}: PropsWithChildren<
  FormFooterProps & {
    /** Scrolls the fields, such as to a failure at the top. */
    scrollRef?: Ref<KeyboardAwareScrollViewRef> | undefined;
  }
>): ReactElement {
  const [footerHeight, setFooterHeight] = useState(0);
  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
        bottomOffset={footerHeight}
      >
        {children}
      </KeyboardAwareScrollView>
      <FormFooter note={note} primary={primary} secondary={secondary} onHeight={setFooterHeight} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  content: { paddingBottom: theme.space.xxl },
  bar: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
    borderTopWidth: theme.hairline,
    borderTopColor: theme.desktop.border,
    backgroundColor: theme.desktop.popover,
  },
  note: { textAlign: "center" },
  actions: { flexDirection: "row", gap: theme.space.sm },
  // Cancel and the primary action share the row in equal halves.
  action: { flex: 1 },
  compactBar: { flexDirection: "row", alignItems: "center", paddingTop: theme.space.sm },
  compactNote: { flex: 1, minWidth: 0 },
  compactAction: { width: 184, flexGrow: 1 },
}));
