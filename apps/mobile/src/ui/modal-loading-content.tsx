import type { PropsWithChildren, ReactElement } from "react";
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Text } from "./text";
import { ModalLoadingContext } from "./modal-loading-context";

/** Keeps child reads and drafts alive while one loader replaces the incomplete form. */
export function ModalLoadingContent({
  loading,
  label = "Loading…",
  style,
  children,
}: PropsWithChildren<{
  loading: boolean;
  label?: string | undefined;
  style?: StyleProp<ViewStyle>;
}>): ReactElement {
  const theme = useAppTheme();
  return (
    <>
      {loading ? (
        <View
          style={styles.loading}
          accessibilityRole="progressbar"
          accessibilityLabel={label}
          accessibilityState={{ busy: true }}
        >
          <View style={styles.loadingRow}>
            <View style={styles.spinner}>
              <ActivityIndicator color={theme.desktop.mutedForeground} />
            </View>
            <Text variant="subhead" tone="secondary">
              {label}
            </Text>
          </View>
          <View
            style={styles.lines}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={[styles.line, styles.longLine]} />
            <View style={[styles.line, styles.shortLine]} />
          </View>
        </View>
      ) : null}
      <View
        style={loading ? styles.hidden : [styles.content, style]}
        accessibilityElementsHidden={loading}
        importantForAccessibility={loading ? "no-hide-descendants" : "auto"}
      >
        <ModalLoadingContext value={loading}>{children}</ModalLoadingContext>
      </View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    minHeight: 160,
    gap: theme.space.lg,
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.xxl,
  },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  spinner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.desktop.muted,
  },
  lines: { gap: theme.space.sm },
  line: { height: 6, borderRadius: 3, backgroundColor: theme.desktop.muted },
  longLine: { width: "80%" },
  shortLine: { width: "60%" },
  hidden: { display: "none" },
  content: { flex: 1 },
}));
