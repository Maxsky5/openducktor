import type { SourceIssue } from "@openducktor/contracts";
import { ISSUE_TYPE_LABELS } from "@openducktor/frontend-core/tasks/board/kanban-task-badge-model";
import { PRIORITY_OPTIONS } from "@openducktor/frontend-core/tasks/create/task-composer-options";
import {
  ISSUE_IMPORT_ISSUE_TYPES,
  ISSUE_IMPORT_LABELS,
  issueImportItemTitle,
  issueImportReviewStatus,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-model";
import type {
  ImportOutcome,
  IssueReview,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-state";
import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownView } from "@/rich-content/markdown/markdown-view";
import { useAppTheme } from "@/theme/app-theme-context";
import { SegmentedControl } from "@/ui/fields";
import { haptics } from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useAnnounce } from "@/ui/use-announce";
import { FormField, ToolbarButton } from "../edit/form-parts";
import { LabelsField } from "../edit/labels-field";

/** The desktop composer icons of the issue types that an import can create. */
const ISSUE_TYPE_ICONS = {
  feature: "sparkles",
  bug: "bug",
  task: "list-todo",
} as const satisfies Record<(typeof ISSUE_IMPORT_ISSUE_TYPES)[number], IconName>;

const PRIORITY_CHOICES = PRIORITY_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
}));

/** The item description, folded by default as on desktop. It renders the provider Markdown. */
function DescriptionDisclosure({ item }: { item: SourceIssue }): ReactElement {
  const theme = useAppTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.disclosure}>
      <Touchable
        feedback="highlight"
        onPress={() => {
          haptics.selection();
          setOpen((current) => !current);
        }}
        radius={theme.radius.md}
        accessibilityRole="button"
        accessibilityLabel={`${ISSUE_IMPORT_LABELS.description} for ${item.title}`}
        accessibilityState={{ expanded: open }}
        style={styles.disclosureHeader}
      >
        <Text variant="callout" weight="medium" style={styles.grow}>
          {ISSUE_IMPORT_LABELS.description}
        </Text>
        <Icon
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          colorValue={theme.desktop.mutedForeground}
        />
      </Touchable>
      {open ? (
        <View style={styles.disclosureBody}>
          {item.description.trim() ? (
            <MarkdownView markdown={item.description} selectable />
          ) : (
            <Text variant="callout" tone="tertiary">
              {ISSUE_IMPORT_LABELS.noDescription}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One selected item in the review step, as the desktop review card: the number, title, and
 * author with Remove, the folded description, the issue type, the priority, the labels, and the
 * result of the last import or refresh with Refresh item after a failure.
 */
export function IssueReviewCard({
  item,
  review,
  outcome,
  knownLabels,
  busy,
  refreshing,
  onOpen,
  onRemove,
  onChange,
  onRefresh,
}: {
  item: SourceIssue;
  review: IssueReview;
  outcome: ImportOutcome | undefined;
  /** Label suggestions: the provider tags of the item, then the workspace labels. */
  knownLabels: readonly string[];
  busy: boolean;
  refreshing: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onChange: (update: Partial<IssueReview>) => void;
  onRefresh: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const created = outcome?.outcome === "created";
  const fieldsDisabled = busy || created;
  const status = issueImportReviewStatus(item, outcome);
  useAnnounce(status?.text);
  const title = issueImportItemTitle(item);
  const statusColors = created
    ? {
        background: theme.desktop.successSurface,
        border: theme.desktop.successBorder,
        text: theme.desktop.successSurfaceForeground,
      }
    : {
        background: theme.desktop.destructiveSurface,
        border: theme.desktop.destructiveBorder,
        text: theme.desktop.destructiveSurfaceForeground,
      };
  return (
    <View style={styles.card} accessibilityLabel={`Review ${item.title}`}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="callout" weight="semibold" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="footnote" tone="tertiary" numberOfLines={1}>
            {item.creator}
          </Text>
        </View>
        <ToolbarButton
          label={ISSUE_IMPORT_LABELS.remove}
          icon="trash-2"
          variant="danger"
          disabled={busy}
          accessibilityLabel={`${ISSUE_IMPORT_LABELS.remove} ${title}`}
          onPress={onRemove}
        />
        <IconButton
          icon="external-link"
          color="tertiaryLabel"
          size={18}
          accessibilityLabel={`Open source item ${item.number}`}
          onPress={onOpen}
        />
      </View>
      <DescriptionDisclosure item={item} />
      <FormField label={ISSUE_IMPORT_LABELS.issueType}>
        <SegmentedControl
          label={ISSUE_IMPORT_LABELS.issueType}
          options={ISSUE_IMPORT_ISSUE_TYPES.map((value) => ({
            value,
            label: ISSUE_TYPE_LABELS[value],
            leading: (
              <Icon
                name={ISSUE_TYPE_ICONS[value]}
                size={14}
                colorValue={
                  review.issueType === value
                    ? theme.desktop.foreground
                    : theme.desktop.mutedForeground
                }
              />
            ),
          }))}
          value={review.issueType}
          onChange={(issueType) => onChange({ issueType })}
          disabled={fieldsDisabled}
        />
      </FormField>
      <FormField label={ISSUE_IMPORT_LABELS.priority}>
        <SegmentedControl
          label={ISSUE_IMPORT_LABELS.priority}
          options={PRIORITY_CHOICES}
          value={String(review.priority)}
          onChange={(priority) => onChange({ priority: Number(priority) })}
          disabled={fieldsDisabled}
        />
      </FormField>
      <FormField label={ISSUE_IMPORT_LABELS.labels}>
        <LabelsField
          labels={review.labels}
          knownLabels={knownLabels}
          editable={!fieldsDisabled}
          onChange={(labels) => onChange({ labels })}
        />
      </FormField>
      {status ? (
        <View
          style={[
            styles.status,
            { backgroundColor: statusColors.background, borderColor: statusColors.border },
          ]}
          accessible
          accessibilityLiveRegion="polite"
        >
          <Icon
            name={created ? "circle-check" : "circle-alert"}
            size={16}
            colorValue={statusColors.text}
          />
          <Text variant="callout" selectable style={[styles.grow, { color: statusColors.text }]}>
            {status.text}
          </Text>
        </View>
      ) : null}
      {outcome?.outcome === "failed" ? (
        <View style={styles.actions}>
          <ToolbarButton
            label={
              refreshing ? ISSUE_IMPORT_LABELS.refreshingItem : ISSUE_IMPORT_LABELS.refreshItem
            }
            icon="refresh"
            variant="outline"
            command
            loading={refreshing}
            disabled={busy}
            onPress={onRefresh}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grow: { flex: 1 },
  card: {
    gap: theme.space.lg,
    padding: theme.space.lg,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.xs },
  headerText: { flex: 1, gap: 2 },
  disclosure: {
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    backgroundColor: theme.colors.nestedFill,
  },
  disclosureHeader: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  disclosureBody: { paddingHorizontal: theme.space.md, paddingBottom: theme.space.md },
  status: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  actions: { flexDirection: "row" },
}));
