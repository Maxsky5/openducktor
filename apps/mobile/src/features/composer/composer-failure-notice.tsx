import type { ComposerFailure } from "@openducktor/frontend-core/sessions/composer/composer-failure";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import { ComposerTextButton } from "./composer-controls";

/**
 * A composer notice as the desktop chat alerts: `rounded-md border px-3 py-2 text-sm` in the
 * destructive or the warning family, with an icon, a title, a message, and an optional action.
 * Screen readers read a new notice after the current speech, while focus stays on the field.
 */
export function ComposerNotice({
  tone,
  title,
  message,
  action,
}: {
  tone: "destructive" | "warning";
  title: string;
  message?: string | null | undefined;
  action?: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  styles.useVariants({ tone });
  useAnnounce(message ? `${title}. ${message}` : title);
  const accent =
    tone === "destructive" ? theme.desktop.destructiveAccent : theme.desktop.warningAccent;
  return (
    <View
      style={styles.notice}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessible={!action}
    >
      <View style={styles.icon}>
        <Icon
          name={tone === "destructive" ? "circle-alert" : "triangle-alert"}
          size={16}
          colorValue={accent}
        />
      </View>
      <View style={styles.body}>
        <Text variant="callout" weight="medium" style={styles.text}>
          {title}
        </Text>
        {message ? (
          <Text variant="footnote" selectable style={styles.text}>
            {message}
          </Text>
        ) : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

/**
 * The failure of a send or a queue action. An unknown result is a warning, because the host can
 * still have taken the message.
 */
export function FailureNotice({
  failure,
  onDismiss,
}: {
  failure: ComposerFailure;
  onDismiss?: (() => void) | undefined;
}): ReactElement {
  return (
    <ComposerNotice
      tone={failure.kind === "result_unknown" ? "warning" : "destructive"}
      title={failure.title}
      message={failure.message}
      action={
        onDismiss ? (
          <ComposerTextButton label="Dismiss" variant="ghost" onPress={onDismiss} />
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  notice: {
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
        destructive: {
          borderColor: theme.desktop.destructiveBorder,
          backgroundColor: theme.desktop.destructiveSurface,
        },
        warning: {
          borderColor: theme.desktop.warningBorder,
          backgroundColor: theme.desktop.warningSurface,
        },
      },
    },
  },
  icon: { paddingTop: 2 },
  body: { flex: 1, gap: theme.space.xxs },
  text: {
    variants: {
      tone: {
        destructive: { color: theme.desktop.destructiveSurfaceForeground },
        warning: { color: theme.desktop.warningSurfaceForeground },
      },
    },
  },
  action: { alignSelf: "center", marginVertical: -theme.space.xs },
}));
