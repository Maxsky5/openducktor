import type { GitCurrentBranch } from "@openducktor/contracts";
import type { DiffDataState } from "@openducktor/frontend-core/git/contracts";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandBlocked } from "@/host-session/active-session-context";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import {
  currentBranchLabel,
  shownTargetCounts,
  targetBranchLabel,
  targetCountsLabel,
  upstreamLabel,
  upstreamSummary,
} from "./changes-model";
import { gitPanelColors } from "./review-colors";

/** A count with its arrow, in the desktop count colors. A zero count does not show. */
function Count({
  direction,
  count,
}: {
  direction: "ahead" | "behind";
  count: number;
}): ReactElement | null {
  const theme = useAppTheme();
  if (count === 0) return null;
  const color = gitPanelColors(theme)[direction];
  return (
    <View style={styles.count}>
      <Icon name={direction === "ahead" ? "arrow-up" : "arrow-down"} size={12} colorValue={color} />
      <Text variant="monoSmall" tabular style={{ color }}>
        {count}
      </Text>
    </View>
  );
}

function BranchLine({
  icon,
  name,
  accessibilityLabel,
  children,
}: {
  icon: IconName;
  name: string;
  accessibilityLabel: string;
  children?: ReactElement | null;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.line} accessible accessibilityLabel={accessibilityLabel}>
      <Icon name={icon} size={14} colorValue={theme.desktop.mutedForeground} />
      <Text variant="mono" numberOfLines={1} ellipsizeMode="middle" style={styles.name}>
        {name}
      </Text>
      {children}
    </View>
  );
}

/** The target line as a control that opens the comparison branch choice. */
function TargetChoice({
  name,
  accessibilityLabel,
  command,
  onPress,
  children,
}: {
  name: string;
  accessibilityLabel: string;
  command: boolean;
  onPress: () => void;
  children?: ReactElement | null;
}): ReactElement {
  const theme = useAppTheme();
  const blocked = useCommandBlocked(command, "Comparison branch");
  return (
    <Touchable
      feedback="highlight"
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={
        blocked
          ? "Available when the host connection is live."
          : "Opens the branches to compare with."
      }
      style={styles.line}
    >
      <Icon name="target" size={14} colorValue={theme.desktop.mutedForeground} />
      <Text variant="mono" numberOfLines={1} ellipsizeMode="middle" style={styles.name}>
        {name}
      </Text>
      {children}
      <Icon name="chevron-up-down" size={14} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
}

/**
 * The checkout and the branch that it compares with, as the desktop Git panel header: the current
 * branch with its upstream state, then the target branch with the commits ahead and behind it.
 * A phone stacks the two branches, so long names keep both ends. With `onChooseTarget`, the
 * target line opens the comparison branch choice.
 */
export function BranchSummary({
  diffData,
  currentBranch,
  onChooseTarget,
  chooseSendsCommand = false,
}: {
  diffData: DiffDataState;
  currentBranch: GitCurrentBranch | null;
  onChooseTarget?: (() => void) | undefined;
  /** True when the choice sends a host command, so it follows the command gate. */
  chooseSendsCommand?: boolean | undefined;
}): ReactElement {
  const branch = currentBranchLabel(currentBranch, diffData.branch, diffData.isLoading);
  const target = targetBranchLabel(diffData);
  const targetCounts = shownTargetCounts(diffData);
  const upstream = upstreamSummary(diffData);
  const upstreamText = upstreamLabel(upstream);
  const targetLabel = `Target branch: ${target}${targetCounts ? `, ${targetCountsLabel(targetCounts, target)}` : ""}`;
  const counts = targetCounts ? (
    <View style={styles.counts}>
      <Count direction="ahead" count={targetCounts.ahead} />
      <Count direction="behind" count={targetCounts.behind} />
    </View>
  ) : null;
  const theme = useAppTheme();
  return (
    <View style={styles.card}>
      <BranchLine
        icon="git-branch"
        name={branch}
        accessibilityLabel={`Current branch: ${branch}${upstreamText ? `, ${upstreamText}` : ""}`}
      >
        {upstream.kind === "counts" ? (
          <View style={styles.counts}>
            <Icon name="cloud" size={13} colorValue={theme.desktop.mutedForeground} />
            <Count direction="ahead" count={upstream.ahead} />
            <Count direction="behind" count={upstream.behind} />
          </View>
        ) : upstream.kind === "unpublished" ? (
          <View style={styles.counts}>
            <Icon name="cloud-off" size={13} colorValue={theme.desktop.mutedForeground} />
            <Text variant="caption1" tone="tertiary">
              Not published
            </Text>
          </View>
        ) : null}
      </BranchLine>
      <View style={styles.divider} />
      {onChooseTarget ? (
        <TargetChoice
          name={target}
          accessibilityLabel={targetLabel}
          command={chooseSendsCommand}
          onPress={onChooseTarget}
        >
          {counts}
        </TargetChoice>
      ) : (
        <BranchLine icon="target" name={target} accessibilityLabel={targetLabel}>
          {counts}
        </BranchLine>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    marginHorizontal: theme.layout.screenPadding,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 40,
  },
  name: { flex: 1, minWidth: 0, color: theme.desktop.foreground },
  divider: { height: theme.hairline, backgroundColor: theme.desktop.border },
  counts: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  count: { flexDirection: "row", alignItems: "center", gap: 1 },
}));
