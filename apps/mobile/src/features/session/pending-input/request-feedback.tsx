import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { CommandFailure } from "@/host-session/command-outcome";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";

/**
 * A feedback box under a request card, as the desktop `QuestionFeedback` and `ApprovalFeedback`:
 * `rounded-md border px-2 py-1.5 text-xs`. A failed reply is red; a reply with a lost result and
 * a capability warning are amber.
 */
export function RequestFeedbackBox({
  tone,
  title,
  message,
}: {
  tone: "destructive" | "warning";
  title?: string | null | undefined;
  message: string;
}): ReactElement {
  styles.useVariants({ tone });
  useAnnounce(title ? `${title}. ${message}` : message);
  return (
    <View
      style={styles.box}
      accessible
      accessibilityRole={tone === "destructive" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
    >
      {title ? (
        <Text variant="footnote" weight="semibold" style={styles.text}>
          {title}
        </Text>
      ) : null}
      <Text variant="footnote" selectable style={styles.text}>
        {message}
      </Text>
    </View>
  );
}

/** The feedback box of a reply failure. A lost result is amber, so the user checks the host. */
export function RequestFailureBox({ failure }: { failure: CommandFailure }): ReactElement {
  return (
    <RequestFeedbackBox
      tone={failure.kind === "unknown" ? "warning" : "destructive"}
      title={failure.title}
      message={failure.message}
    />
  );
}

/** A quiet status line under a request card, such as "Submitting answers…". */
export function RequestStatusLine({ text }: { text: string }): ReactElement {
  useAnnounce(text);
  return (
    <Text variant="footnote" accessibilityLiveRegion="polite" style={styles.status}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: 2,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 6,
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
  text: {
    variants: {
      tone: {
        destructive: { color: theme.desktop.destructiveMuted },
        warning: { color: theme.desktop.warningMuted },
      },
    },
  },
  status: { color: theme.desktop.mutedForeground },
}));
