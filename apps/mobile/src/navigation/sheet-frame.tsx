import { Stack, useRouter } from "expo-router";
import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { useBlockBack } from "./use-block-back";

/**
 * The frame of a compact route sheet that fits its content: a drag handle, the title with one
 * line of context, and a close control. A drag down or the system back gesture also closes it.
 * iOS draws its own handle.
 */
export function SheetFrame({
  title,
  subtitle,
  closable = true,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string | undefined;
  /**
   * False while an action runs, so the close control, the swipe down, and Android Back cannot
   * close the sheet, and its result stays in view.
   */
  closable?: boolean | undefined;
}>): ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // A new options object renders the whole navigator again, so it changes only with `closable`.
  const options = useMemo(() => ({ gestureEnabled: closable }), [closable]);
  useBlockBack(!closable);
  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + 16 }]}>
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
          onPress={() => router.back()}
        />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    gap: theme.space.xl,
    paddingHorizontal: theme.space.xl,
    paddingTop: Platform.select({ ios: theme.space.xxl, default: theme.space.sm }),
    backgroundColor: theme.colors.surface,
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
