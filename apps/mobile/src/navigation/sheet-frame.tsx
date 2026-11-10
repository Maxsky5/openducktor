import { Stack, useNavigation } from "expo-router";
import { useMinimumLoader } from "@openducktor/frontend-core/lib/use-minimum-loader";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { Platform, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SafeAreaView } from "react-native-screens/experimental";
import { StyleSheet } from "react-native-unistyles";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { ModalLoadingContent } from "@/ui/modal-loading-content";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import { useBlockBack } from "./use-block-back";
import { closeScreen } from "./close-screen";

const SheetContentView = Platform.OS === "ios" ? SafeAreaView : View;

/**
 * The frame of a compact route sheet that fits its content: a drag handle, the title with one
 * line of context, and a close control. Its contents scroll when they exceed the sheet height.
 * A drag down or the system back gesture also closes it. iOS draws its own handle.
 */
export function SheetFrame({
  title,
  subtitle,
  closable = true,
  loading = false,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string | undefined;
  /**
   * False while an action runs, so the close control, the swipe down, and Android Back cannot
   * close the sheet, and its result stays in view.
   */
  closable?: boolean | undefined;
  loading?: boolean | undefined;
}>): ReactElement {
  const navigation = useNavigation();
  const isLoading = useMinimumLoader(loading);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // A new options object renders the whole navigator again, so it changes only with `closable`.
  const options = useMemo(() => ({ gestureEnabled: closable }), [closable]);
  useBlockBack(!closable);
  return (
    <ScrollView
      style={[
        styles.scroll,
        // Android measures fitted sheets at content height; bound their scroll viewport.
        Platform.OS === "android" && { maxHeight: height - insets.top },
      ]}
      contentInsetAdjustmentBehavior={Platform.OS === "ios" ? "automatic" : undefined}
      automaticallyAdjustKeyboardInsets={Platform.OS === "ios" ? true : undefined}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
    >
      {/* The iOS native sheet supplies local horizontal insets as Yoga margins. */}
      <SheetContentView
        edges={Platform.OS === "ios" ? { left: true, right: true } : undefined}
        style={[styles.root, { paddingBottom: Platform.OS === "ios" ? 16 : insets.bottom + 16 }]}
      >
        {/* While an action runs, a swipe down cannot close the sheet, so its result stays in view. */}
        <Stack.Screen options={options} />
        {Platform.OS === "ios" ? null : <View style={styles.handle} />}
        <View style={styles.header}>
          <View style={styles.titles}>
            <Text variant="title2" accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text variant="callout" tone="tertiary">
                {subtitle}
              </Text>
            ) : null}
          </View>
          <IconButton
            icon="x"
            variant="filled"
            accessibilityLabel="Close"
            disabled={!closable}
            onPress={() => closeScreen(navigation)}
          />
        </View>
        <ModalLoadingContent loading={isLoading} style={styles.content}>
          {children}
        </ModalLoadingContent>
      </SheetContentView>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { flex: 0 },
  scroll: { flexGrow: 0, flexShrink: 1, backgroundColor: theme.colors.surface },
  root: {
    flex: 0,
    gap: theme.space.xl,
    paddingHorizontal: theme.space.xl,
    paddingTop: Platform.select({ ios: theme.space.xxl, default: theme.space.sm }),
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.fillStrong,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.md },
  titles: { flex: 1, gap: 2 },
}));
