import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";

/**
 * A row of the desktop bottom stack: `rounded-md border px-3 py-2 text-sm`. `info` is the
 * runtime status row with its info icon. `destructive` is the auxiliary error row, an alert.
 */
export function SessionNoticeRow({
  tone,
  title,
  action,
  children,
}: {
  tone: "info" | "destructive";
  /** A short title in medium weight before the text. */
  title?: string | undefined;
  /** A control at the end of the row, such as Retry. */
  action?: ReactNode;
  children: string;
}): ReactElement {
  const theme = useAppTheme();
  styles.useVariants({ tone });
  useAnnounce(title ? `${title}. ${children}` : children);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole={tone === "destructive" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
    >
      {tone === "info" ? (
        <View style={styles.icon}>
          <Icon name="info" size={16} colorValue={theme.desktop.infoAccent} />
        </View>
      ) : null}
      <View style={styles.body}>
        {title ? (
          <Text variant="callout" weight="medium" style={styles.text}>
            {title}
          </Text>
        ) : null}
        <Text variant="callout" selectable style={styles.text}>
          {children}
        </Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    variants: {
      tone: {
        info: { borderColor: theme.desktop.infoBorder, backgroundColor: theme.desktop.infoSurface },
        destructive: {
          borderColor: theme.desktop.destructiveBorder,
          backgroundColor: theme.desktop.destructiveSurface,
        },
      },
    },
  },
  // Centers the icon on the first text line.
  icon: { paddingTop: 2 },
  body: { flex: 1, minWidth: 0 },
  text: {
    variants: {
      tone: {
        info: { color: theme.desktop.infoSurfaceForeground },
        destructive: { color: theme.desktop.destructiveSurfaceForeground },
      },
    },
  },
}));
