import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import type { ChangesScopeStatus } from "./changes-model";

/**
 * A scope without a file list, as the desktop empty diff state: a muted Git folder icon in a
 * circle and one quiet line. A failed read also shows the reason and a retry, because the phone
 * has no notice next to the list.
 */
export function ChangesState({
  status,
  onRetry,
}: {
  status: Exclude<ChangesScopeStatus, { kind: "ready" }>;
  onRetry: (() => void) | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const message = status.kind === "loading" ? null : status.message;
  const failed = status.kind === "error" || status.kind === "unavailable";
  useAnnounce(failed ? `${status.title}. ${status.message}` : null);
  return (
    <View
      style={styles.state}
      accessibilityRole={status.kind === "error" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.icon}>
        <Icon name="folder-git-2" size={20} colorValue={theme.desktop.mutedForeground} />
      </View>
      <View style={styles.copy}>
        <Text variant="callout" weight="medium" style={styles.title}>
          {status.title}
        </Text>
        {message ? (
          <Text variant="footnote" selectable style={styles.message}>
            {message}
          </Text>
        ) : null}
      </View>
      {status.kind === "error" && onRetry ? (
        // A button hugs the start edge, so a wrapper lets this state center it.
        <View>
          <Button label="Try Again" icon="refresh" variant="outline" size="sm" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  state: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.xxl,
    paddingVertical: theme.space.huge,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.chipFill,
  },
  copy: { alignItems: "center", gap: theme.space.xs, maxWidth: 340 },
  title: { textAlign: "center", color: theme.desktop.mutedForeground },
  message: { textAlign: "center", color: withAlpha(theme.desktop.mutedForeground, 0.7) },
}));
