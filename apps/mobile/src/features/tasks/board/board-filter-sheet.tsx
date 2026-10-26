import type { IssueType } from "@openducktor/contracts";
import type { KanbanBoardFilterModel } from "@openducktor/frontend-core/tasks/board/use-kanban-board-filter-model";
import { type ReactElement, type ReactNode, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { Button } from "@/ui/button";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { SearchField } from "@/ui/search-field";
import { SectionHeader } from "@/ui/surfaces";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { issueTypePaint } from "../presentation/task-badge-paint";
import { IssueTypeMark } from "../presentation/task-chip";
import { chipColors, priorityChipPaint } from "../presentation/task-chip-paint";
import {
  ISSUE_TYPE_FILTER_OPTIONS,
  PRIORITY_FILTER_OPTIONS,
  toggleFilterValue,
} from "./board-filter-controls";

/** The Labels list shows a search field from this many labels, as the desktop Labels menu. */
const LABEL_SEARCH_THRESHOLD = 7;

/**
 * One value of a filter, as a desktop filter menu item: a check box, an optional icon, and the
 * label. A press toggles the value and keeps the sheet open.
 */
function FilterOption({
  label,
  accessibilityLabel,
  leading,
  checked,
  onToggle,
}: {
  label: string;
  accessibilityLabel: string;
  leading?: ReactNode;
  checked: boolean;
  onToggle: () => void;
}): ReactElement {
  const theme = useAppTheme();
  styles.useVariants({ checked });
  return (
    <Touchable
      feedback="highlight"
      onPress={() => {
        haptics.selection();
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked }}
      style={styles.option}
    >
      <View style={styles.checkbox}>
        {checked ? (
          <Icon name="check" size={13} colorValue={theme.desktop.primaryForeground} />
        ) : null}
      </View>
      {leading}
      <Text variant="body" numberOfLines={1} style={styles.optionLabel}>
        {label}
      </Text>
    </Touchable>
  );
}

/** A filter group: the desktop menu name with its icon, then its values in one card. */
function FilterGroup({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: IconName;
  count: number;
  children: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View>
      <SectionHeader
        title={title}
        trailing={
          <View style={styles.groupTrailing}>
            {count > 0 ? (
              <Text variant="footnote" tabular style={styles.muted}>
                {`${count} selected`}
              </Text>
            ) : null}
            <Icon name={icon} size={14} colorValue={theme.desktop.mutedForeground} />
          </View>
        }
      />
      <View style={styles.group}>{children}</View>
    </View>
  );
}

/**
 * The board filters, after the desktop filter bar: the Labels, Type, and Priority menus as
 * groups of check boxes, with the icons and words of the desktop menus. Several values of a
 * group combine. Clear removes the search and every filter.
 */
export function BoardFilterSheet({
  visible,
  filter,
  onClose,
}: {
  visible: boolean;
  filter: KanbanBoardFilterModel;
  onClose: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const { value, labelOptions, onChange, onClear, isActive } = filter;
  const [labelQuery, setLabelQuery] = useState("");
  const term = labelQuery.trim().toLowerCase();
  const shownLabels = term
    ? labelOptions.filter((label) => label.toLowerCase().includes(term))
    : labelOptions;
  const selectedLabels = new Set(value.labels);
  return (
    <InPlaceSheet
      visible={visible}
      title="Filter Tasks"
      onClose={() => {
        setLabelQuery("");
        onClose();
      }}
      padded={false}
      footer={
        <Button
          label="Clear Search and Filters"
          icon="x"
          variant="outline"
          size="lg"
          disabled={!isActive}
          onPress={onClear}
          fill
        />
      }
    >
      <FilterGroup title="Labels" icon="tag" count={value.labels.length}>
        {labelOptions.length >= LABEL_SEARCH_THRESHOLD ? (
          <View style={styles.search}>
            <SearchField
              value={labelQuery}
              onChangeText={setLabelQuery}
              placeholder="Search labels"
              accessibilityLabel="Search labels"
            />
          </View>
        ) : null}
        {labelOptions.length === 0 ? (
          <Text variant="subhead" style={[styles.note, styles.muted]}>
            No task in this workspace has labels.
          </Text>
        ) : null}
        {labelOptions.length > 0 && shownLabels.length === 0 ? (
          <Text variant="subhead" style={[styles.note, styles.muted]}>
            No labels found.
          </Text>
        ) : null}
        {shownLabels.map((label) => (
          <FilterOption
            key={label}
            label={label}
            accessibilityLabel={`Label ${label}`}
            leading={<Icon name="tag" size={14} colorValue={theme.desktop.mutedForeground} />}
            checked={selectedLabels.has(label)}
            onToggle={() => onChange({ labels: toggleFilterValue(value.labels, label) })}
          />
        ))}
      </FilterGroup>
      <FilterGroup title="Type" icon="blocks" count={value.issueTypes.length}>
        {ISSUE_TYPE_FILTER_OPTIONS.map((option) => (
          <FilterOption
            key={option.value}
            label={option.label}
            accessibilityLabel={option.label}
            leading={<TypeIcon issueType={option.value} />}
            checked={value.issueTypes.includes(option.value)}
            onToggle={() =>
              onChange({ issueTypes: toggleFilterValue(value.issueTypes, option.value) })
            }
          />
        ))}
      </FilterGroup>
      <FilterGroup title="Priority" icon="flag" count={value.priorities.length}>
        {PRIORITY_FILTER_OPTIONS.map((option) => (
          <FilterOption
            key={option.value}
            label={option.label}
            accessibilityLabel={option.accessibilityLabel}
            leading={
              <View
                style={[
                  styles.priorityDot,
                  { backgroundColor: chipColors(theme, priorityChipPaint(option.value)).dot },
                ]}
              />
            }
            checked={value.priorities.includes(option.value)}
            onToggle={() =>
              onChange({ priorities: toggleFilterValue(value.priorities, option.value) })
            }
          />
        ))}
      </FilterGroup>
      <View style={styles.bottom} />
    </InPlaceSheet>
  );
}

function TypeIcon({ issueType }: { issueType: IssueType }): ReactElement {
  return <IssueTypeMark issueType={issueType} icon={issueTypePaint(issueType).icon} size={15} />;
}

const styles = StyleSheet.create((theme) => ({
  group: {
    marginHorizontal: theme.layout.screenPadding,
    paddingVertical: 4,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.popover,
    boxShadow: theme.shadows.card,
    overflow: "hidden",
  },
  groupTrailing: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  muted: { color: theme.desktop.mutedForeground },
  search: { paddingHorizontal: theme.space.sm, paddingTop: 4, paddingBottom: theme.space.xs },
  note: { paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md },
  option: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: theme.space.lg,
  },
  checkbox: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 5,
    borderWidth: 1,
    variants: {
      checked: {
        true: { backgroundColor: theme.desktop.primary, borderColor: theme.desktop.primary },
        false: { backgroundColor: "transparent", borderColor: theme.desktop.input },
      },
    },
  },
  optionLabel: { flex: 1, color: theme.desktop.popoverForeground },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 3 },
  bottom: { height: theme.space.xxl },
}));
