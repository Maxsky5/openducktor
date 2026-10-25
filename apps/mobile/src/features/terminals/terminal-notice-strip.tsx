import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";

/**
 * `error` is a failure, `warning` needs attention, and `muted` informs. The desktop strips use
 * `bg-destructive/10 text-destructive`, `bg-warning-surface text-warning-surface-foreground`, and
 * `bg-muted text-muted-foreground`.
 */
export type TerminalNoticeTone = "error" | "warning" | "muted";

const TONE_ICONS = {
  error: "circle-alert",
  warning: "triangle-alert",
  muted: "info",
} as const satisfies Record<TerminalNoticeTone, IconName>;

/**
 * A full-width notice strip, as the desktop terminal status messages and exit notice. `edge`
 * places the border between the strip and the terminal: a strip above it has a bottom border, a
 * strip below it a top border. The icon and the text name the tone, so color is not the only sign.
 */
export function TerminalNoticeStrip({
  tone,
  title,
  message,
  edge,
  action,
}: {
  tone: TerminalNoticeTone;
  title: string;
  message?: string | null | undefined;
  edge: "top" | "bottom";
  action?: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  styles.useVariants({ tone, edge });
  useAnnounce(message ? `${title} ${message}` : title);
  const color = {
    error: theme.desktop.destructive,
    warning: theme.desktop.warningSurfaceForeground,
    muted: theme.desktop.mutedForeground,
  }[tone];
  return (
    <View
      style={styles.strip}
      accessible={!action}
      accessibilityRole={tone === "error" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.icon}>
        <Icon name={TONE_ICONS[tone]} size={14} colorValue={color} />
      </View>
      <Text variant="subhead" selectable style={[styles.body, { color }]}>
        <Text variant="subhead" weight="semibold" style={{ color }}>
          {title}
        </Text>
        {message ? ` ${message}` : null}
      </Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

/** The terminal socket failed. A terminal screen shows it once, above its list or its terminal. */
export function TerminalTransportNotice({ message }: { message: string }): ReactElement {
  return (
    <TerminalNoticeStrip
      tone="error"
      edge="top"
      title="Terminal connection failed."
      message={`${message} The app reconnects and attaches again.`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderColor: theme.desktop.border,
    variants: {
      tone: {
        error: { backgroundColor: theme.colors.destructiveWash },
        warning: { backgroundColor: theme.desktop.warningSurface },
        muted: { backgroundColor: theme.desktop.muted },
      },
      edge: {
        top: { borderBottomWidth: theme.hairline },
        bottom: { borderTopWidth: theme.hairline },
      },
    },
  },
  // The icon sits on the first text line.
  icon: { paddingTop: 2 },
  body: { flex: 1 },
  action: { alignSelf: "center" },
}));
