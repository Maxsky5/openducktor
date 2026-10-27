import { TASK_READS_LOADING_COPY as COPY } from "@openducktor/frontend-core/tasks/details/task-close-copy";
import type { ReactElement } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Text } from "@/ui/text";

/**
 * The one loader of a task confirmation, as on desktop. It shows until every read of the
 * confirmation ends, so no part of the content changes after it shows.
 */
export function TaskReadsLoading(): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.loading} accessibilityRole="progressbar">
      <ActivityIndicator color={theme.desktop.statusRunning} />
      <View style={styles.text}>
        <Text variant="subhead" weight="medium" style={styles.centered}>
          {COPY.title}
        </Text>
        <Text variant="subhead" tone="tertiary" style={styles.centered}>
          {COPY.description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.md,
    padding: theme.space.xxl,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.insetFill,
  },
  text: { gap: 2 },
  centered: { textAlign: "center" },
}));
