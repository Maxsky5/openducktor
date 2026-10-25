import type { DiffScope } from "@openducktor/frontend-core/git/contracts";
import type {
  GitHeaderNotice,
  GitPanelTabCounts,
} from "@openducktor/frontend-core/git/model/git-panel-header";
import { memo, type ReactElement, useState } from "react";
import { View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion, touchSlop } from "@/theme/tokens";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useAnnounce } from "@/ui/use-announce";
import { CHANGES_SCOPE_OPTIONS, type ChangesTotals } from "./changes-model";
import type { FileListViewMode } from "./changes-view-state";
import { gitPanelColors } from "./review-colors";

/** A notice strip under the branch card, as the desktop Git panel header notices. */
export function HeaderNotice({ notice }: { notice: GitHeaderNotice }): ReactElement {
  styles.useVariants({ tone: notice.tone });
  useAnnounce(notice.tone === "error" ? notice.text : null);
  return (
    <View
      style={styles.notice}
      accessible
      accessibilityRole={notice.tone === "error" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
    >
      <Text variant="footnote" selectable style={styles.noticeText}>
        {notice.text}
      </Text>
    </View>
  );
}

/**
 * The desktop "Uncommitted changes" and "Branch changes" tabs: content labels with a file count
 * and a primary underline under the selected tab. On a phone the two tabs share the width.
 */
export const ScopeTabs = memo(function ScopeTabs({
  scope,
  counts,
  onSelect,
}: {
  scope: DiffScope;
  counts: GitPanelTabCounts;
  onSelect: (scope: DiffScope) => void;
}): ReactElement {
  const [width, setWidth] = useState(0);
  const reducedMotion = useReducedMotion();
  const index = CHANGES_SCOPE_OPTIONS.findIndex((option) => option.value === scope);
  const tabWidth = width / CHANGES_SCOPE_OPTIONS.length;
  return (
    <View
      style={styles.tabs}
      accessibilityRole="tablist"
      accessibilityLabel="Git views"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {CHANGES_SCOPE_OPTIONS.map((option) => {
        const selected = option.value === scope;
        const count = counts[option.value];
        return (
          <Touchable
            key={option.value}
            feedback="opacity"
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onSelect(option.value);
            }}
            accessibilityRole="tab"
            accessibilityLabel={
              count === null
                ? option.label
                : `${option.label}, ${count} ${count === 1 ? "file" : "files"}`
            }
            accessibilityState={{ selected }}
            containerStyle={styles.tabBox}
            style={styles.tab}
          >
            <Text
              variant="subhead"
              weight={selected ? "semibold" : "medium"}
              numberOfLines={1}
              style={selected ? styles.tabSelected : styles.tabLabel}
            >
              {option.label}
            </Text>
            {count === null ? null : (
              <View style={styles.tabCount}>
                <Text variant="caption2" tabular style={styles.tabCountText}>
                  {count}
                </Text>
              </View>
            )}
          </Touchable>
        );
      })}
      {width > 0 && index >= 0 ? (
        <Animated.View
          style={[
            styles.indicator,
            {
              width: tabWidth - INDICATOR_INSET * 2,
              transform: [{ translateX: index * tabWidth + INDICATOR_INSET }],
              transitionProperty: "transform",
              transitionDuration: reducedMotion ? 0 : motion.fast,
              transitionTimingFunction: motion.easeOut,
            },
          ]}
        />
      ) : null}
    </View>
  );
});

const INDICATOR_INSET = 6;

/** The size of one option of the tree and list toggle, as on desktop. */
const TOGGLE_OPTION = { width: 34, height: 28 } as const;

const VIEW_MODES = [
  { mode: "tree", icon: "list-tree", label: "Tree view" },
  { mode: "list", icon: "list", label: "List view" },
] as const satisfies ReadonlyArray<{ mode: FileListViewMode; icon: IconName; label: string }>;

/**
 * The desktop list header: the changed file count, the added and removed line totals, and the
 * tree or list view toggle.
 */
export const FileListHeader = memo(function FileListHeader({
  totals,
  viewMode,
  onViewModeChange,
}: {
  totals: ChangesTotals;
  viewMode: FileListViewMode;
  onViewModeChange: (mode: FileListViewMode) => void;
}): ReactElement {
  const theme = useAppTheme();
  const colors = gitPanelColors(theme);
  const files = `${totals.fileCount} changed ${totals.fileCount === 1 ? "file" : "files"}`;
  // The touch area of each option reaches the platform minimum, and no option reaches over the
  // other one.
  const verticalSlop = touchSlop(TOGGLE_OPTION.height);
  const outerSlop = 2 * touchSlop(TOGGLE_OPTION.width);
  return (
    <View style={styles.listHeader}>
      <Text variant="footnote" style={styles.listCount} numberOfLines={1}>
        {files}
      </Text>
      <View
        style={styles.totals}
        accessible
        accessibilityLabel={`${totals.additions} lines added, ${totals.deletions} removed`}
      >
        {totals.additions > 0 ? (
          <Text variant="monoSmall" tabular style={{ color: colors.totalAdded }}>
            {`+${totals.additions}`}
          </Text>
        ) : null}
        {totals.deletions > 0 ? (
          <Text variant="monoSmall" tabular style={{ color: colors.totalDeleted }}>
            {`-${totals.deletions}`}
          </Text>
        ) : null}
      </View>
      <View
        style={styles.toggle}
        accessibilityRole="radiogroup"
        accessibilityLabel="File list view"
      >
        {VIEW_MODES.map((option, index) => {
          const active = option.mode === viewMode;
          return (
            <Touchable
              key={option.mode}
              feedback="opacity"
              hitSlop={{
                top: verticalSlop,
                bottom: verticalSlop,
                left: index === 0 ? outerSlop : 0,
                right: index === VIEW_MODES.length - 1 ? outerSlop : 0,
              }}
              onPress={() => {
                if (active) return;
                haptics.selection();
                onViewModeChange(option.mode);
              }}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: active }}
              style={active ? styles.toggleActive : styles.toggleOption}
            >
              <Icon
                name={option.icon}
                size={15}
                colorValue={active ? theme.desktop.foreground : theme.desktop.mutedForeground}
              />
            </Touchable>
          );
        })}
      </View>
    </View>
  );
});

/** The pending Inline Diff Comments and the action that sends them to the agent. */
export function PendingComments({
  count,
  recipientLabel,
  blockedReason,
  onRetry,
  canSend,
  onSend,
}: {
  count: number;
  recipientLabel: "Builder" | "agent";
  blockedReason: string | null;
  /** Reads the recipient again after a failed read, or null. */
  onRetry: (() => void) | null;
  canSend: boolean;
  onSend: () => void;
}): ReactElement {
  useAnnounce(blockedReason);
  return (
    <View style={styles.pending} accessibilityLiveRegion="polite">
      <View style={styles.pendingText}>
        <View style={styles.pendingTitle}>
          <Badge label="Pending" tone="warning" />
          <Text variant="subhead" weight="semibold" tabular>
            {`${count} ${count === 1 ? "comment" : "comments"}`}
          </Text>
        </View>
        <Text variant="footnote" style={styles.muted}>
          {`${count === 1 ? "It goes" : "They go"} with the next message to the ${recipientLabel}.`}
        </Text>
        {blockedReason ? (
          <Text variant="footnote" style={styles.warning}>
            {blockedReason}
          </Text>
        ) : null}
        {onRetry ? (
          <Button
            label="Try Again"
            size="sm"
            variant="gray"
            onPress={onRetry}
            style={styles.retry}
          />
        ) : null}
      </View>
      <Button
        label="Send"
        icon="send"
        size="sm"
        variant="filled"
        disabled={!canSend}
        onPress={onSend}
        accessibilityLabel="Send feedback"
        accessibilityHint={`Opens the ${recipientLabel} session, where the composer shows the pending comments.`}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  notice: {
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.sm,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
    variants: {
      tone: {
        warning: { backgroundColor: theme.tones.warning.surface },
        error: { backgroundColor: theme.colors.destructiveWash },
        muted: { backgroundColor: theme.desktop.muted },
      },
    },
  },
  noticeText: {
    variants: {
      tone: {
        warning: { color: theme.tones.warning.text },
        error: { color: theme.desktop.destructive },
        muted: { color: theme.desktop.mutedForeground },
      },
    },
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  tabBox: { flex: 1 },
  tab: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: theme.space.sm,
  },
  tabLabel: { flexShrink: 1, color: theme.desktop.mutedForeground },
  tabSelected: { flexShrink: 1, color: theme.desktop.foreground },
  tabCount: {
    minWidth: 18,
    paddingHorizontal: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.desktop.muted,
    alignItems: "center",
  },
  tabCountText: { ...theme.type.caption2, fontSize: 11, color: theme.desktop.mutedForeground },
  indicator: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.desktop.primary,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 44,
    paddingHorizontal: theme.layout.screenPadding,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.colors.diffDivider,
  },
  listCount: { flex: 1, color: theme.desktop.mutedForeground },
  totals: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggle: {
    flexDirection: "row",
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.colors.diffDivider,
    overflow: "hidden",
  },
  toggleOption: { ...TOGGLE_OPTION, alignItems: "center", justifyContent: "center" },
  toggleActive: {
    ...TOGGLE_OPTION,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.desktop.muted,
  },
  pending: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    marginHorizontal: theme.layout.screenPadding,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  pendingText: { flex: 1, gap: theme.space.xxs },
  pendingTitle: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  muted: { color: theme.desktop.mutedForeground },
  warning: { color: theme.desktop.warningMuted },
  retry: { alignSelf: "flex-start", marginTop: theme.space.xs },
}));
