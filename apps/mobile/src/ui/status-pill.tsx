import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { LoaderSpinner } from "./loader-spinner";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import type { AppTheme } from "@/theme/tokens";
import { Text } from "./text";

/** The desktop badge variants that a status uses (`components/ui/badge-variants.ts`). */
export type StatusPillVariant = "secondary" | "success" | "warning" | "danger";

/** The surface, text, and dot colors of each variant, from the desktop theme. */
const statusPillColors = (theme: AppTheme, variant: StatusPillVariant) => {
  const { desktop } = theme;
  switch (variant) {
    case "secondary":
      return {
        surface: desktop.secondary,
        text: desktop.secondaryForeground,
        dot: withAlpha(desktop.mutedForeground, 0.6),
      };
    case "success":
      return {
        surface: desktop.successSurface,
        text: desktop.successSurfaceForeground,
        dot: desktop.successAccent,
      };
    case "warning":
      return {
        surface: desktop.warningSurface,
        text: desktop.warningSurfaceForeground,
        dot: desktop.warningAccent,
      };
    case "danger":
      return {
        surface: desktop.destructiveSurface,
        text: desktop.destructiveSurfaceForeground,
        dot: desktop.destructiveAccent,
      };
  }
};

/**
 * The desktop status pill (`DiagnosticsStatusPill`): a capsule with a colored dot and a word, or a
 * turning loader while work runs. The word names the state, so color is never the only signal.
 */
export const StatusPill = memo(function StatusPill({
  label,
  variant,
  busy = false,
  accessibilityLabel,
}: {
  label: string;
  variant: StatusPillVariant;
  busy?: boolean | undefined;
  accessibilityLabel?: string | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const colors = statusPillColors(theme, variant);
  return (
    <View
      style={[styles.pill, { backgroundColor: colors.surface }]}
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {busy ? (
        <LoaderSpinner size={12} color={colors.text} />
      ) : (
        <View style={[styles.dot, { backgroundColor: colors.dot }]} />
      )}
      <Text variant="footnote" weight="medium" numberOfLines={1} style={{ color: colors.text }}>
        {label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 6,
    minHeight: 22,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
}));
