import { memo, type ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { type AppTheme, touchSlop } from "@/theme/tokens";
import { referenceChipIcon } from "@/features/session/reference-chip-paint";
import { withAlpha } from "@/theme/color-alpha";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useAnnounce } from "@/ui/use-announce";
import { type ComposerSuggestion, type ComposerTrigger, suggestionText } from "./composer-segments";
import type { ComposerSuggestions } from "./use-composer-suggestions";

/** The desktop menu labels. */
const MENU_LABELS = {
  slash: "Slash commands",
  reference: "References",
  skill: "Skills",
} satisfies Record<ComposerTrigger["kind"], string>;

const LOADING_LABELS = {
  slash: "Loading slash commands…",
  reference: "Searching files",
  skill: "Loading skills",
} satisfies Record<ComposerTrigger["kind"], string>;

/**
 * The icon of a row: the chip icon of the suggestion. A Slash Command chip has no icon, so its
 * row shows the desktop terminal icon.
 */
const iconFor = (suggestion: ComposerSuggestion): IconName =>
  referenceChipIcon(
    suggestion.kind,
    suggestion.kind === "file" ? suggestion.file.kind : "default",
  ) ?? "terminal";

/**
 * The colors of the round icon tile of a row: muted for commands and files, the purple family
 * for skills, and the teal family for subagents. The mobile palette has no purple or teal family,
 * so the tiles use violet and cyan, as the reference chips.
 */
const tileColors = (theme: AppTheme, suggestion: ComposerSuggestion) => {
  const { palette, desktop } = theme;
  const dark = theme.scheme === "dark";
  switch (suggestion.kind) {
    case "skill":
      return {
        backgroundColor: dark ? withAlpha(palette.violet950, 0.5) : palette.violet100,
        color: dark ? palette.violet200 : palette.violet700,
      };
    case "subagent":
      return {
        backgroundColor: dark ? withAlpha(palette.cyan950, 0.5) : palette.cyan100,
        color: dark ? palette.cyan200 : palette.cyan700,
      };
    case "slash_command":
    case "file":
      return { backgroundColor: desktop.muted, color: desktop.mutedForeground };
  }
};

/**
 * The desktop composer menu for the trigger that the user typed: a card above the field with the
 * menu name and the position of the highlighted row, its loading, failure, and empty states, and
 * one row for each suggestion. Hardware Enter picks the first row, so the first row shows
 * highlighted.
 */
export function ComposerSuggestionList({
  trigger,
  suggestions,
  supportsSubagentReferences,
  onPick,
}: {
  trigger: ComposerTrigger;
  suggestions: ComposerSuggestions;
  /** The empty state of the reference menu names subagents only when the runtime offers them. */
  supportsSubagentReferences: boolean;
  onPick: (suggestion: ComposerSuggestion) => void;
}): ReactElement {
  const theme = useAppTheme();
  const { items, isLoading, error, retry } = suggestions;
  useAnnounce(error);
  const label = MENU_LABELS[trigger.kind];
  const emptyTitle =
    trigger.kind === "slash"
      ? "No slash commands found."
      : trigger.kind === "skill"
        ? "No skills found."
        : supportsSubagentReferences
          ? "No references found."
          : "No files found.";
  return (
    <View style={styles.panel} accessibilityLabel={label}>
      <View style={styles.header}>
        <Text variant="footnote" weight="medium" style={styles.muted}>
          {label}
        </Text>
        {items.length > 0 ? (
          <Text variant="footnote" tabular style={styles.muted}>
            {`1 / ${items.length}`}
          </Text>
        ) : null}
      </View>
      {isLoading ? (
        <View style={styles.feedback} accessibilityRole="progressbar">
          <LoaderSpinner size={16} color={theme.desktop.mutedForeground} />
          <Text variant="callout" style={styles.muted}>
            {LOADING_LABELS[trigger.kind]}
          </Text>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.feedback, styles.between]} accessibilityLiveRegion="polite">
          <Text variant="callout" selectable style={[styles.error, styles.grow]}>
            {error}
          </Text>
          {retry ? (
            <Touchable
              feedback="scale"
              onPress={retry}
              radius={theme.radius.md}
              hitSlop={touchSlop(28)}
              accessibilityRole="button"
              accessibilityLabel="Retry"
              style={styles.retry}
            >
              <Text variant="footnote" weight="medium">
                Retry
              </Text>
            </Touchable>
          ) : null}
        </View>
      ) : null}
      {!isLoading && !error && items.length === 0 ? (
        <View style={styles.empty} accessibilityRole="text">
          <View style={styles.emptyTile}>
            <Icon name="search" size={16} colorValue={theme.desktop.mutedForeground} />
          </View>
          <View style={styles.grow}>
            <Text variant="callout" weight="medium">
              {emptyTitle}
            </Text>
            <Text variant="footnote" style={styles.muted}>
              Try a different name or clear your search.
            </Text>
          </View>
        </View>
      ) : null}
      <ScrollView keyboardShouldPersistTaps="always" style={styles.list}>
        {/* The list shows at most 30 suggestions. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {items.map((item, index) => (
          <SuggestionRow key={item.id} suggestion={item} isActive={index === 0} onPick={onPick} />
        ))}
      </ScrollView>
    </View>
  );
}

const SuggestionRow = memo(function SuggestionRow({
  suggestion,
  isActive,
  onPick,
}: {
  suggestion: ComposerSuggestion;
  isActive: boolean;
  onPick: (suggestion: ComposerSuggestion) => void;
}): ReactElement {
  const theme = useAppTheme();
  const { title, subtitle, description, source, accessibilityLabel } = suggestionText(suggestion);
  const tile = tileColors(theme, suggestion);
  return (
    <Touchable
      feedback="highlight"
      onPress={() => onPick(suggestion)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={isActive ? "Inserts it. Enter on a keyboard picks it too." : "Inserts it."}
      accessibilityState={{ selected: isActive }}
      // The pressed highlight replaces the background of the row, so the active row keeps its
      // highlight on the touch area.
      containerStyle={isActive ? styles.activeRow : null}
      style={styles.row}
    >
      <View style={[styles.tile, { backgroundColor: tile.backgroundColor }]}>
        <Icon name={iconFor(suggestion)} size={14} colorValue={tile.color} />
      </View>
      <View style={styles.grow}>
        <View style={styles.titleLine}>
          <Text variant="callout" weight="medium" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {source ? (
            <View style={styles.source}>
              <Text variant="caption2" overline numberOfLines={1} style={styles.sourceText}>
                {source}
              </Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text
            variant="footnote"
            numberOfLines={1}
            ellipsizeMode={suggestion.kind === "file" ? "middle" : "tail"}
            style={styles.muted}
          >
            {subtitle}
          </Text>
        ) : null}
        {description ? (
          <Text variant="footnote" numberOfLines={2} style={styles.muted}>
            {description}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={16} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
});

const styles = StyleSheet.create((theme) => ({
  // The desktop menu: `rounded-xl border bg-popover shadow-lg`. The panel and its list give up
  // height when the screen has no room, so the composer field stays above the keyboard.
  panel: {
    flexShrink: 1,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.popover,
    boxShadow: theme.shadows.overlay,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.desktop.border,
  },
  muted: { color: theme.desktop.mutedForeground },
  feedback: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.desktop.border,
  },
  between: { justifyContent: "space-between" },
  error: { color: theme.desktop.destructive },
  retry: {
    minHeight: 28,
    paddingHorizontal: theme.space.sm,
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.card,
  },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.xl,
  },
  emptyTile: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.desktop.muted,
  },
  // The desktop list is at most 16rem high.
  list: { flexShrink: 1, maxHeight: 256 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  activeRow: { backgroundColor: theme.desktop.selectedSurface },
  tile: {
    width: 28,
    height: 28,
    marginTop: 2,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  title: { flexShrink: 1, color: theme.desktop.foreground },
  source: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.desktop.muted,
  },
  sourceText: { fontSize: 10, lineHeight: 12, color: theme.desktop.mutedForeground },
}));
