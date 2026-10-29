import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Text } from "@/ui/text";
import { gitPanelColors } from "./review-colors";
import { lineCountAccessibilityLabel } from "./review-presentation";

/** Zero counts stay hidden, as on desktop. */
export const LineCounts = memo(function LineCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): ReactElement {
  const theme = useAppTheme();
  const colors = gitPanelColors(theme);
  return (
    <View
      style={styles.counts}
      accessible
      accessibilityLabel={lineCountAccessibilityLabel(additions, deletions)}
    >
      {additions > 0 ? (
        <Text variant="monoSmall" tabular style={{ color: colors.added }}>
          {`+${additions}`}
        </Text>
      ) : null}
      {deletions > 0 ? (
        <Text variant="monoSmall" tabular style={{ color: colors.deleted }}>
          {`-${deletions}`}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  counts: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
}));
