import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { type CalloutTone, calloutColors } from "./callout-colors";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { useAnnounce } from "./use-announce";

const ICONS = {
  destructive: "circle-alert",
  warning: "triangle-alert",
  info: "info",
  success: "circle-check",
} as const satisfies Record<CalloutTone, IconName>;

/**
 * A tinted message, as the desktop `DiagnosticsCallout` (`size="sm"`) and the desktop notices
 * (`size="md"`): an icon, an optional title, the message, and an optional action.
 */
export function Callout({
  tone,
  title,
  message,
  detail,
  action,
  size = "md",
}: {
  tone: CalloutTone;
  title?: string | undefined;
  message?: string | null | undefined;
  /** A second line in the muted color of the tone, such as the next action. */
  detail?: string | null | undefined;
  action?: ReactNode;
  size?: "sm" | "md";
}): ReactElement {
  const theme = useAppTheme();
  const colors = calloutColors(theme, tone);
  styles.useVariants({ size });
  useAnnounce([title, message, detail].filter((part) => part).join(". "));
  const textVariant = size === "sm" ? "footnote" : "subhead";
  return (
    <View
      style={[styles.callout, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole={tone === "destructive" ? "alert" : undefined}
      accessibilityLiveRegion="polite"
      accessible={action === undefined}
    >
      <View style={styles.icon}>
        <Icon
          name={ICONS[tone]}
          size={size === "sm" ? 14 : 16}
          colorValue={size === "sm" ? colors.text : colors.muted}
        />
      </View>
      <View style={styles.body}>
        {title ? (
          <Text variant={textVariant} weight="medium" style={{ color: colors.text }}>
            {title}
          </Text>
        ) : null}
        {message ? (
          <Text
            variant={textVariant}
            style={{ color: size === "md" && title ? colors.muted : colors.text }}
            selectable
          >
            {message}
          </Text>
        ) : null}
        {detail ? (
          <Text variant={textVariant} style={{ color: colors.muted }} selectable>
            {detail}
          </Text>
        ) : null}
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  callout: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderCurve: "continuous",
    borderRadius: theme.radius.lg,
    variants: {
      size: {
        sm: {
          gap: theme.space.sm,
          paddingHorizontal: theme.space.md,
          paddingVertical: theme.space.sm,
        },
        md: { gap: theme.space.md, padding: theme.space.lg },
      },
    },
  },
  // Aligns the icon with the first line of text.
  icon: { paddingTop: 1 },
  body: { flex: 1, minWidth: 0, gap: theme.space.xs },
  action: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.space.sm,
    paddingTop: theme.space.xs,
  },
}));
