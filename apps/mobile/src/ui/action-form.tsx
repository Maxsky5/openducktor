import {
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useContext,
  useState,
} from "react";
import { useWindowDimensions, View } from "react-native";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
  KeyboardStickyView,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useSheetClose } from "@/navigation/sheet-close";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button, ButtonDensityContext } from "./button";
import { Text } from "./text";
import { KEYBOARD_DISMISS_ON_DRAG } from "./keyboard-dismiss";
import { useAnnounce } from "./use-announce";
import { useCompactHeight } from "./use-wide-layout";
import { ModalLoadingContext } from "./modal-loading-context";

type FormFooterProps = {
  /** Why the primary action is disabled, or null when it is enabled. */
  note?: string | null | undefined;
  /** The one `filled` button of the form, or null when the form has no action now. */
  primary: ReactNode;
  /** A third action of the form, such as Run in Background. It shows above Cancel. */
  secondary?: ReactNode;
};

/** Larger text puts the actions in the form scroll, so a tall footer leaves room for the fields. */
export const useScrollableFormFooter = (): boolean => useWindowDimensions().fontScale > 1.3;

/**
 * The footer of a workflow form, as the desktop dialog footer: a top rule, the reason why the
 * primary action is disabled, then the actions in a row. Cancel takes the width of its label and
 * the primary action takes the rest, so a long primary label, such as "Push main and mark done",
 * fits on a phone. In a sheet, Cancel is the close control, so the sheet header shows only its
 * title. The forms show in
 * full sheets, which the keyboard does not resize on iOS or Android, so the footer moves up with
 * the keyboard. A low window puts the reason and actions in one row at normal text size.
 * Larger text stacks the actions in the form scroll. `onHeight` reports a fixed footer's height,
 * so the content can scroll above it.
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
  const scrollable = useScrollableFormFooter();
  const claimFooter = sheet?.claimFooter;
  const loading = useContext(ModalLoadingContext);
  // Before the first paint, so the header never shows its own close control for a frame.
  useLayoutEffect(() => {
    if (!loading) return claimFooter?.();
  }, [claimFooter, loading]);
  const bottom = Math.max(insets.bottom, compact ? theme.space.sm : theme.space.lg);
  useAnnounce(loading ? null : note);
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
  const Bar = compact && !scrollable ? OneRowFooterBar : StackedFooterBar;
  const bar = (
    <Bar
      note={note}
      primary={primary}
      secondary={secondary}
      cancel={cancel}
      inSheet={sheet !== null}
      bottom={bottom}
      onHeight={onHeight}
      stacked={scrollable}
    />
  );
  if (scrollable) return bar;
  return (
    <KeyboardStickyView
      // The safe area padding goes under the keyboard, so a small gap stays above it.
      offset={{ closed: 0, opened: bottom - theme.space.md }}
    >
      {bar}
    </KeyboardStickyView>
  );
}

type FooterBarProps = FormFooterProps & {
  /** Cancel in a sheet, which closes it. */
  cancel: ReactNode;
  inSheet: boolean;
  bottom: number;
  onHeight: ((height: number) => void) | undefined;
  stacked: boolean;
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
  stacked,
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
      <ButtonDensityContext value="compact">
        {inSheet && secondary ? <View style={styles.actions}>{secondary}</View> : null}
        <View style={[styles.actions, stacked && styles.stackedActions]}>
          {cancel || secondary ? (
            <View style={stacked ? undefined : styles.hugAction}>{cancel ?? secondary}</View>
          ) : null}
          {primary ? <View style={stacked ? undefined : styles.action}>{primary}</View> : null}
        </View>
      </ButtonDensityContext>
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
      {note ? (
        <View style={styles.compactNote}>
          <Text
            variant="footnote"
            tone="tertiary"
            numberOfLines={2}
            accessibilityLiveRegion="polite"
          >
            {note}
          </Text>
        </View>
      ) : null}
      <ButtonDensityContext value="compact">
        {inSheet && secondary ? <View style={styles.hugAction}>{secondary}</View> : null}
        {cancel || secondary ? <View style={styles.hugAction}>{cancel ?? secondary}</View> : null}
        {primary ? <View style={styles.action}>{primary}</View> : null}
      </ButtonDensityContext>
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
  const scrollableFooter = useScrollableFormFooter();
  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
        bottomOffset={scrollableFooter ? 0 : footerHeight}
      >
        {children}
        {scrollableFooter ? (
          <FormFooter note={note} primary={primary} secondary={secondary} />
        ) : null}
      </KeyboardAwareScrollView>
      {scrollableFooter ? null : (
        <FormFooter
          note={note}
          primary={primary}
          secondary={secondary}
          onHeight={setFooterHeight}
        />
      )}
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
  stackedActions: { flexDirection: "column" },
  action: { flex: 1, flexBasis: 0, minWidth: 0 },
  hugAction: { flexShrink: 0 },
  compactBar: { flexDirection: "row", alignItems: "center", paddingTop: theme.space.sm },
  compactNote: { flex: 1, minWidth: 0 },
}));
