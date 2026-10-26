import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { Modal, Platform, ScrollView, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { ModalFeedbackHost } from "@/feedback/feedback-host";
import { IconButton } from "./icon-button";
import { Text } from "./text";
import { Touchable } from "./touchable";
import { KEYBOARD_DISMISS_ON_DRAG } from "./keyboard-dismiss";

export type InPlaceSheetProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  /** Closes the sheet. A sheet whose action runs passes `dismissible={false}` instead. */
  onClose: () => void;
  /** False while an action runs: the close control and the system back gesture then do nothing. */
  dismissible?: boolean | undefined;
  /** Controls below the scrolling content, such as Cancel and Confirm. */
  footer?: ReactNode;
  /**
   * False when the footer has a Cancel button, so the header shows only the title. Back and the
   * iOS swipe still call `onClose`.
   */
  closeControl?: boolean | undefined;
  /** False when the content is a list that scrolls by itself, such as a `FlashList`. */
  scrolls?: boolean | undefined;
  /** False for content with its own insets, such as grouped list sections. */
  padded?: boolean | undefined;
  /** `surface` for a picker list on the desktop popover color. The default is the grouped color. */
  background?: "grouped" | "surface" | undefined;
  /** The sheet finished opening. Android opens the keyboard for a field only after this. */
  onShow?: (() => void) | undefined;
}>;

/**
 * A sheet above the current screen for a choice that belongs to it, such as a confirmation or
 * the board filters. The screen stays mounted, so its state and scroll position stay. iOS shows a
 * page sheet that a swipe down closes, with Done in the navigation bar. Android shows a Material
 * full-screen dialog with a close control.
 */
export function InPlaceSheet({
  visible,
  title,
  onClose,
  dismissible = true,
  footer,
  closeControl = true,
  scrolls = true,
  padded = true,
  background = "grouped",
  onShow,
  children,
}: InPlaceSheetProps): ReactElement {
  const ios = Platform.OS === "ios";
  // A closed sheet renders with its screen, so it picks plain style entries instead of a
  // stylesheet variant, which runs native code on each render.
  const backgroundStyle = background === "surface" ? styles.surface : styles.grouped;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={ios ? "pageSheet" : "fullScreen"}
      // Android removes the content of a closing modal at once, while its window still slides
      // out. A transparent window then slides out unseen, instead of as an empty white screen.
      transparent={!ios}
      onShow={onShow}
      onRequestClose={() => {
        if (dismissible) onClose();
      }}
    >
      {/* A modal is its own native window, so its touches need their own gesture root. */}
      <GestureHandlerRootView style={styles.gestureRoot}>
        {/* The theme background sits on a React Native view, so it follows a theme change. */}
        <View style={[styles.root, backgroundStyle]}>
          <SafeAreaView
            style={styles.fill}
            edges={ios ? ["bottom", "left", "right"] : ["top", "bottom", "left", "right"]}
          >
            <View style={styles.header}>
              {ios ? <View style={styles.headerSide} /> : null}
              <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
                {title}
              </Text>
              {ios ? (
                <View style={[styles.headerSide, styles.headerEnd]}>
                  {closeControl ? (
                    <Touchable
                      feedback="opacity"
                      onPress={onClose}
                      disabled={!dismissible}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel="Done"
                    >
                      <Text variant="headline" tone="tint">
                        Done
                      </Text>
                    </Touchable>
                  ) : null}
                </View>
              ) : null}
              {!ios && closeControl ? (
                <IconButton
                  icon="x"
                  variant="filled"
                  accessibilityLabel="Close"
                  onPress={onClose}
                  disabled={!dismissible}
                />
              ) : null}
            </View>
            {/* An iOS page sheet starts below the screen top, so the view reads its screen position.
                The body moves with a transform and changes its size once, so a list in it does not
                lay out again on each keyboard frame. The clip keeps it under the sheet header. */}
            <View style={styles.keyboardClip}>
              <KeyboardAvoidingView
                behavior="translate-with-padding"
                automaticOffset
                style={styles.body}
              >
                {scrolls ? (
                  <ScrollView
                    style={styles.body}
                    contentContainerStyle={[styles.content, padded && styles.padded]}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
                  >
                    {children}
                  </ScrollView>
                ) : (
                  <View style={styles.body}>{children}</View>
                )}
                {footer ? <View style={[styles.footer, backgroundStyle]}>{footer}</View> : null}
              </KeyboardAvoidingView>
            </View>
          </SafeAreaView>
        </View>
        {/* A closing sheet gives its toasts back to the root at once, so they do not slide out
            with its window. */}
        {visible ? <ModalFeedbackHost /> : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  gestureRoot: { flex: 1 },
  fill: { flex: 1 },
  root: { flex: 1 },
  grouped: { backgroundColor: theme.colors.groupedBackground },
  surface: { backgroundColor: theme.desktop.popover },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    minHeight: Platform.select({ ios: 56, default: 64 }),
    paddingLeft: Platform.select({ ios: theme.layout.screenPadding, default: theme.space.xl }),
    paddingRight: Platform.select({ ios: theme.layout.screenPadding, default: theme.space.lg }),
  },
  headerSide: { width: 72 },
  headerEnd: { alignItems: "flex-end" },
  title: Platform.select({
    ios: { ...theme.type.headline, flex: 1, textAlign: "center", color: theme.colors.label },
    default: { ...theme.type.title2, flex: 1, color: theme.colors.label },
  }),
  body: { flex: 1 },
  keyboardClip: { flex: 1, overflow: "hidden" },
  content: { paddingBottom: theme.space.xxxl, gap: theme.space.md },
  padded: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.sm },
  footer: {
    flexDirection: "row",
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.md,
    borderTopWidth: theme.hairline,
    borderTopColor: theme.desktop.border,
  },
}));
