import type { SourceIssue } from "@openducktor/contracts";
import {
  ISSUE_IMPORT_LABELS,
  issueImportItemTitle,
  issueImportLinkedText,
  issueImportUpdatedText,
} from "@openducktor/frontend-core/tasks/issue-import/issue-import-model";
import { memo, type ReactElement } from "react";
import { type DimensionValue, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { TextPlaceholder } from "@/ui/placeholders";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

const CHECK_SIZE = 22;

/** The desktop check box: an outlined square, violet with a white check when checked. */
function IssueCheckbox({
  checked,
  muted = false,
}: {
  checked: boolean;
  /** Dims the box of an item that cannot be selected. */
  muted?: boolean;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.checkbox, checked && styles.checkboxChecked, muted && styles.muted]}
    >
      {checked ? (
        <Icon name="check" size={15} colorValue={theme.desktop.primaryForeground} />
      ) : null}
    </View>
  );
}

/** The provider number of an item as the desktop mono capsule, such as "#42". */
function IssueNumber({ number }: { number: string | number }): ReactElement {
  return (
    <View style={styles.number}>
      <Text variant="monoSmall" weight="medium" tabular style={styles.numberText}>
        {`#${number}`}
      </Text>
    </View>
  );
}

/**
 * One open item of the Git provider, as the desktop result row: a check box, the number and
 * title, the author, the update date, and the provider tags. A tap selects the item for import;
 * an item that a task already links cannot be selected. The trailing control opens the item in
 * the browser. The press layer fills the row under its content, so screen readers reach the open
 * control apart from the check box, also on a linked row.
 */
export const IssueRow = memo(function IssueRow({
  item,
  selected,
  onToggle,
  onOpen,
}: {
  item: SourceIssue;
  selected: boolean;
  onToggle: (item: SourceIssue) => void;
  onOpen: (item: SourceIssue) => void;
}): ReactElement {
  const theme = useAppTheme();
  const linked = item.linkedTaskId ?? null;
  // A selected item that another client linked stays removable here.
  const locked = linked !== null && !selected;
  const title = issueImportItemTitle(item);
  styles.useVariants({ state: linked ? "linked" : selected ? "selected" : "idle" });
  return (
    <View style={styles.row}>
      <Touchable
        feedback="highlight"
        onPress={() => onToggle(item)}
        disabled={locked}
        dimWhenDisabled={false}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${title}${linked ? `, ${issueImportLinkedText(linked)}` : ""}`}
        style={styles.pressLayer}
      >
        {null}
      </Touchable>
      <View pointerEvents="none" style={styles.check}>
        <IssueCheckbox checked={selected} muted={locked} />
      </View>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.body}
      >
        <View style={styles.titleRow}>
          <IssueNumber number={item.number} />
          <Text variant="callout" weight="semibold" numberOfLines={3} style={styles.title}>
            {item.title}
          </Text>
        </View>
        <View style={styles.meta}>
          {linked ? (
            <View style={styles.linked}>
              <Icon name="link-2" size={12} colorValue={theme.desktop.secondaryForeground} />
              <Text variant="caption1" style={styles.linkedText}>
                {ISSUE_IMPORT_LABELS.linked}
              </Text>
            </View>
          ) : null}
          <Text variant="footnote" tone="tertiary" numberOfLines={1} style={styles.shrink}>
            {item.creator}
          </Text>
          <Text variant="footnote" tone="tertiary" accessibilityElementsHidden>
            ·
          </Text>
          <Text variant="footnote" tone="tertiary" numberOfLines={1}>
            {issueImportUpdatedText(item.updatedAt)}
          </Text>
          {item.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text variant="caption1" numberOfLines={1} style={styles.tagText}>
                {tag}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <IconButton
        icon="external-link"
        color="tertiaryLabel"
        size={18}
        accessibilityLabel={`Open source item ${item.number}`}
        onPress={() => onOpen(item)}
      />
    </View>
  );
});

/**
 * An item row for the first load: the check box, the number capsule, and bars in place of the
 * title and the author line, with the space of the open control. It uses the row styles, so the
 * loaded list takes its exact place.
 */
export function IssueRowPlaceholder({
  titleWidth,
  metaWidth,
}: {
  titleWidth: DimensionValue;
  metaWidth: DimensionValue;
}): ReactElement {
  styles.useVariants({ state: "idle" });
  return (
    <View style={styles.row}>
      <View style={styles.check}>
        <View style={[styles.checkbox, styles.placeholderBox]} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={styles.number}>
            <TextPlaceholder variant="monoSmall" width={22} />
          </View>
          <TextPlaceholder variant="callout" width={titleWidth} style={styles.title} />
        </View>
        <TextPlaceholder variant="footnote" width={metaWidth} />
      </View>
      <View style={styles.placeholderOpen} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    paddingLeft: theme.layout.screenPadding - 2,
    paddingRight: theme.space.xs,
    paddingVertical: 14,
    borderLeftWidth: 2,
    variants: {
      state: {
        idle: { borderLeftColor: "transparent", backgroundColor: theme.desktop.card },
        selected: {
          borderLeftColor: theme.desktop.primary,
          backgroundColor: withAlpha(theme.desktop.primary, 0.05),
        },
        linked: {
          borderLeftColor: "transparent",
          backgroundColor: theme.colors.insetFill,
        },
      },
    },
  },
  pressLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  check: { paddingTop: 1 },
  checkbox: {
    width: CHECK_SIZE,
    height: CHECK_SIZE,
    borderRadius: 6,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { borderColor: theme.desktop.primary, backgroundColor: theme.desktop.primary },
  muted: { opacity: 0.45 },
  body: { flex: 1, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  title: {
    flex: 1,
    variants: {
      state: {
        idle: { color: theme.desktop.foreground },
        selected: { color: theme.desktop.foreground },
        linked: { color: theme.desktop.mutedForeground },
      },
    },
  },
  number: {
    marginTop: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.background,
  },
  numberText: { color: theme.desktop.mutedForeground },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.space.sm,
    rowGap: 4,
  },
  shrink: { flexShrink: 1 },
  placeholderBox: { borderColor: theme.colors.fill, backgroundColor: theme.colors.fill },
  // The touch area of the plain open control (`IconButton`).
  placeholderOpen: { width: theme.touchTarget - 4, height: theme.touchTarget - 4 },
  linked: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.desktop.secondary,
  },
  linkedText: { color: theme.desktop.secondaryForeground },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.border,
  },
  tagText: {
    color: theme.desktop.foreground,
    fontFamily: theme.fonts.sans.regular,
    fontWeight: "400",
  },
}));
