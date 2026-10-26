import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewCheck,
} from "@openducktor/contracts";
import {
  PULL_REQUEST_COMMENT_FILTERS,
  type PullRequestCommentAuthorFilter,
  type PullRequestCommentCounts,
} from "@openducktor/frontend-core/review/pull-request-comment-filters";
import {
  aggregateLabel,
  checkBadgeVariant,
  checkLabel,
} from "@openducktor/frontend-core/review/task-execution-ci-presentation";
import { memo, type ReactElement, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { CollapseChevron } from "@/ui/collapse-chevron";
import { multiplyAlpha } from "@/theme/color-alpha";
import { ActionMenu, type ActionMenuItem } from "@/ui/action-menu";
import { SegmentedControl } from "@/ui/fields";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { checkDetails } from "./checks-model";
import { CiBadge } from "./checks-parts";
import {
  AGGREGATE_STATUS_PRESENTATION,
  CHECK_STATUS_PRESENTATION,
  ciStatusTextColor,
} from "./checks-presentation";

/** The left inset of the check details: under the check name, after the chevron and the icon. */
const DETAIL_INSET = 52;

/** The Checks section header: the summary, the aggregate status, and the open control. */
export const ChecksHeaderRow = memo(function ChecksHeaderRow({
  aggregateStatus,
  summary,
  open,
  onToggle,
}: {
  aggregateStatus: PullRequestReviewAggregateStatus;
  summary: string;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const presentation = AGGREGATE_STATUS_PRESENTATION[aggregateStatus];
  const color = ciStatusTextColor(theme, presentation.text);
  const status = aggregateLabel(aggregateStatus);
  return (
    <Touchable
      feedback="highlight"
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`Checks, ${summary}, ${status}`}
      accessibilityHint={open ? "Hides the checks." : "Shows the checks."}
      accessibilityState={{ expanded: open }}
      style={styles.sectionHeader}
    >
      <CollapseChevron collapsed={!open} colorValue={theme.desktop.mutedForeground} />
      <Icon name="circle-check" size={16} colorValue={color} />
      <Text variant="callout" weight="semibold" style={styles.sectionTitle}>
        Checks
      </Text>
      <Text variant="footnote" weight="medium" numberOfLines={1} style={[styles.grow, { color }]}>
        {summary}
      </Text>
      <CiBadge label={status} variant={presentation.badge} />
    </Touchable>
  );
});

/**
 * One check, as the desktop check card: the status icon and the check name, the status in its
 * color, and an open control. A tap shows the workflow, the details, and the run times.
 */
export const CheckRow = memo(function CheckRow({
  rowKey,
  check,
  open,
  now,
  onToggle,
  onOpenLink,
}: {
  rowKey: string;
  check: PullRequestReviewCheck;
  open: boolean;
  now: number;
  onToggle: (key: string) => void;
  onOpenLink: (url: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  const presentation = CHECK_STATUS_PRESENTATION[checkBadgeVariant(check)];
  const color = ciStatusTextColor(theme, presentation.text);
  const label = checkLabel(check);
  const details = useMemo(() => (open ? checkDetails(check, now) : []), [check, now, open]);
  const url = check.url;
  return (
    <View style={styles.check}>
      <View style={styles.checkLine}>
        <Touchable
          feedback="highlight"
          onPress={() => onToggle(rowKey)}
          accessibilityRole="button"
          accessibilityLabel={`${check.name}, ${label}`}
          accessibilityHint={open ? "Hides the check details." : "Shows the check details."}
          accessibilityState={{ expanded: open }}
          containerStyle={styles.grow}
          style={styles.checkSummary}
        >
          {/* A new key gives a recycled row a chevron without a turn animation. */}
          <CollapseChevron
            key={rowKey}
            collapsed={!open}
            colorValue={theme.desktop.mutedForeground}
          />
          <Icon name={presentation.icon} size={16} colorValue={color} />
          <Text variant="callout" weight="medium" numberOfLines={2} style={styles.grow}>
            {check.name}
          </Text>
          <Text
            variant="footnote"
            weight="medium"
            numberOfLines={1}
            style={[styles.capitalize, { color }]}
          >
            {label}
          </Text>
        </Touchable>
        {url ? (
          <IconButton
            icon="external-link"
            size={15}
            color="tertiaryLabel"
            accessibilityLabel={`Open ${check.name} check`}
            onPress={() => onOpenLink(url)}
          />
        ) : (
          <View style={styles.linkSlot} />
        )}
      </View>
      {open ? (
        <View style={styles.details}>
          {details.length === 0 ? (
            <Text variant="footnote" style={styles.detailLabel}>
              No details reported.
            </Text>
          ) : (
            details.map((detail) => (
              <View key={detail.label} style={styles.detail}>
                <Text variant="footnote" style={styles.detailLabel}>
                  {detail.label}
                </Text>
                <Text variant="footnote" selectable style={styles.detailValue}>
                  {detail.value}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
});

const HIDE_RESOLVED = "hide_resolved";

/**
 * The Comments section header, and under an open section with comments the desktop author
 * filter and the filter menu with Hide resolved.
 */
export const CommentsHeaderRow = memo(function CommentsHeaderRow({
  total,
  counts,
  open,
  filter,
  hideResolved,
  onToggle,
  onFilterChange,
  onHideResolvedChange,
}: {
  total: number;
  counts: PullRequestCommentCounts;
  open: boolean;
  filter: PullRequestCommentAuthorFilter;
  hideResolved: boolean;
  onToggle: () => void;
  onFilterChange: (filter: PullRequestCommentAuthorFilter) => void;
  onHideResolvedChange: (hideResolved: boolean) => void;
}): ReactElement {
  const theme = useAppTheme();
  const options = useMemo(
    () =>
      PULL_REQUEST_COMMENT_FILTERS.map((option) => ({
        value: option.id,
        label: `${option.label} ${counts[option.id]}`,
      })),
    [counts],
  );
  const menuItems = useMemo<ActionMenuItem[]>(
    () => [{ id: HIDE_RESOLVED, title: "Hide resolved", checked: hideResolved }],
    [hideResolved],
  );
  return (
    <View style={styles.commentsHeader}>
      <Touchable
        feedback="highlight"
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`Comments, ${total}`}
        accessibilityHint={open ? "Hides the comments." : "Shows the comments."}
        accessibilityState={{ expanded: open }}
        style={styles.sectionHeader}
      >
        <CollapseChevron collapsed={!open} colorValue={theme.desktop.mutedForeground} />
        <Icon name="message-square" size={16} colorValue={theme.desktop.mutedForeground} />
        <Text variant="callout" weight="semibold" style={styles.sectionTitle}>
          Comments
        </Text>
        <CiBadge
          label={String(total)}
          variant="secondary"
          accessibilityLabel={`${total} ${total === 1 ? "comment" : "comments"}`}
        />
      </Touchable>
      {open && total > 0 ? (
        <View style={styles.filters}>
          <View style={styles.grow}>
            <SegmentedControl<PullRequestCommentAuthorFilter>
              label="Comment authors"
              options={options}
              value={filter}
              onChange={onFilterChange}
            />
          </View>
          <ActionMenu
            title="Filter comments"
            items={menuItems}
            onSelect={(id) => {
              if (id === HIDE_RESOLVED) onHideResolvedChange(!hideResolved);
            }}
          >
            <IconButton
              icon="list-filter"
              size={18}
              color={hideResolved ? "tint" : "secondaryLabel"}
              selected={hideResolved}
              accessibilityLabel={
                hideResolved ? "Filter comments, resolved comments hidden" : "Filter comments"
              }
              onPress={() => {}}
            />
          </ActionMenu>
        </View>
      ) : null}
    </View>
  );
});

/** A short note in place of a list, such as "No checks reported." */
export function ChecksListNote({ text, inset }: { text: string; inset: boolean }): ReactElement {
  styles.useVariants({ inset });
  return (
    <Text variant="callout" style={styles.note}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  grow: { flex: 1, minWidth: 0 },
  sectionHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: 10,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  sectionTitle: { color: theme.desktop.foreground },
  check: {
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
    backgroundColor: multiplyAlpha(theme.desktop.card, 0.4),
  },
  checkLine: { flexDirection: "row", alignItems: "center", paddingRight: theme.space.xs },
  checkSummary: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingLeft: theme.layout.screenPadding,
    paddingRight: theme.space.xs,
    paddingVertical: theme.space.sm,
  },
  capitalize: { textTransform: "capitalize", maxWidth: 120 },
  linkSlot: { width: theme.touchTarget },
  details: {
    gap: theme.space.xs,
    paddingLeft: DETAIL_INSET,
    paddingRight: theme.layout.screenPadding,
    paddingBottom: theme.space.md,
  },
  detail: { flexDirection: "row", gap: theme.space.md },
  detailLabel: { width: 88, color: theme.desktop.mutedForeground },
  detailValue: { flex: 1, minWidth: 0, color: theme.desktop.foreground },
  commentsHeader: {},
  filters: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
    paddingLeft: theme.layout.screenPadding,
    paddingRight: theme.space.xs,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.xs,
  },
  note: {
    color: theme.desktop.mutedForeground,
    paddingVertical: theme.space.lg,
    variants: {
      inset: {
        true: {
          paddingHorizontal: theme.layout.screenPadding,
          borderBottomWidth: theme.hairline,
          borderBottomColor: theme.desktop.border,
        },
        false: { textAlign: "center", paddingHorizontal: theme.layout.screenPadding },
      },
    },
  },
}));
