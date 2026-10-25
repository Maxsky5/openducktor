import { humanDate } from "@openducktor/frontend-core/tasks/presentation/task-display";
import { type ReactElement, useDeferredValue, useState } from "react";
import { TextInput, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownView } from "@/rich-content/markdown/markdown-view";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { haptics } from "@/ui/haptics";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import { ToolbarButton, ViewSwitch } from "./form-parts";
import { SKELETON_PULSE } from "@/theme/tokens";

/** A phone shows the Markdown text or its preview, one at a time. */
export type DocumentPaneView = "write" | "preview";

const VIEWS = [
  { value: "write", label: "Write", icon: "file-pen-line" },
  { value: "preview", label: "Preview", icon: "eye" },
] as const;

const SKELETON_WIDTHS = ["40%", "100%", "84%"] as const;

const lineCountLabel = (markdown: string): string => {
  const count = markdown.trim().length === 0 ? 0 : markdown.split(/\r?\n/).length;
  return `${count.toLocaleString()} ${count === 1 ? "line" : "lines"}`;
};

function LoadingPane(): ReactElement {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      style={[styles.pane, styles.skeleton, reducedMotion ? null : SKELETON_PULSE]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading the document"
    >
      {SKELETON_WIDTHS.map((width) => (
        <View key={width} style={[styles.skeletonLine, { width }]} />
      ))}
    </Animated.View>
  );
}

/**
 * The Spec Document or the Implementation Plan as the desktop document editor: a header card with
 * the title, the view switch, the line count, the save state, and Revert, then the Markdown text
 * in the mono font or its preview. A phone shows one view at a time.
 */
export function DocumentEditor({
  title,
  subtitle,
  placeholder,
  markdown,
  view,
  onViewChange,
  updatedAt,
  isLoading,
  editable,
  error,
  hasUnsavedChanges,
  onMarkdownChange,
  onRevert,
  onRetryLoad,
}: {
  title: string;
  subtitle: string;
  placeholder: string;
  markdown: string;
  view: DocumentPaneView;
  onViewChange: (view: DocumentPaneView) => void;
  updatedAt: string | null;
  isLoading: boolean;
  editable: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;
  onMarkdownChange: (markdown: string) => void;
  onRevert: () => void;
  onRetryLoad: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const [focused, setFocused] = useState(false);
  const deferredMarkdown = useDeferredValue(markdown);
  const showSkeleton = isLoading && !hasUnsavedChanges && markdown.trim().length === 0;
  styles.useVariants({ focused });
  useAnnounce(error);
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text variant="callout" weight="semibold" accessibilityRole="header">
              {title}
            </Text>
            <Text variant="footnote" tone="tertiary">
              {subtitle}
            </Text>
          </View>
        </View>
        <View style={styles.headerRow}>
          <ViewSwitch
            label={`${title} view`}
            options={VIEWS}
            value={view}
            onChange={(next) => {
              haptics.selection();
              onViewChange(next);
            }}
          />
          <View style={styles.grow} />
          <ToolbarButton
            label="Revert"
            icon="rotate-ccw"
            variant="outline"
            disabled={!editable || !hasUnsavedChanges}
            accessibilityLabel={`Revert the ${title.toLowerCase()} to the saved version`}
            onPress={onRevert}
          />
        </View>
        <View style={styles.meta}>
          <Text variant="footnote" tone="tertiary" tabular>
            {lineCountLabel(markdown)}
          </Text>
          <Text variant="footnote" tone="tertiary">
            {`Last saved: ${updatedAt ? humanDate(updatedAt) : "Not saved yet"}`}
          </Text>
          {hasUnsavedChanges ? (
            <Text variant="footnote" weight="medium" style={styles.unsaved}>
              Unsaved changes
            </Text>
          ) : (
            <Text variant="footnote" tone="tertiary">
              All changes saved
            </Text>
          )}
        </View>
      </View>

      {error ? (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <Text variant="callout" selectable style={styles.errorText}>
            {error}
          </Text>
          <View>
            <ToolbarButton label="Retry" icon="refresh" variant="outline" onPress={onRetryLoad} />
          </View>
        </View>
      ) : null}

      <View style={styles.paneGroup}>
        <Text variant="caption2" tone="tertiary" overline>
          {view === "write" ? "Markdown" : "Preview"}
        </Text>
        {showSkeleton ? (
          <LoadingPane />
        ) : view === "write" ? (
          <TextInput
            value={markdown}
            onChangeText={onMarkdownChange}
            editable={editable && !isLoading}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            placeholder={placeholder}
            placeholderTextColor={theme.desktop.mutedForeground}
            selectionColor={theme.colors.selection}
            selectionHandleColor={theme.colors.tint}
            cursorColor={theme.colors.tint}
            accessibilityLabel={`${title}, Markdown`}
            accessibilityState={{ disabled: !editable || isLoading }}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[styles.pane, styles.input]}
          />
        ) : (
          <View style={[styles.pane, styles.preview]} accessibilityLabel={`${title} preview`}>
            {deferredMarkdown.trim().length > 0 ? (
              <MarkdownView markdown={deferredMarkdown} selectable />
            ) : (
              <Text variant="callout" tone="tertiary">
                Nothing to preview yet.
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const PANE_MIN_HEIGHT = 360;

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.space.md },
  grow: { flex: 1 },
  header: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: withAlpha(theme.desktop.muted, 0.7),
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  headerText: { flex: 1, gap: 2 },
  meta: { flexDirection: "row", flexWrap: "wrap", columnGap: theme.space.md, rowGap: 2 },
  unsaved: { color: theme.desktop.warningMuted },
  error: {
    gap: theme.space.sm,
    alignItems: "flex-start",
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.destructiveBorder,
    backgroundColor: theme.desktop.destructiveSurface,
  },
  errorText: { color: theme.desktop.destructiveMuted },
  paneGroup: { gap: theme.space.sm },
  pane: {
    minHeight: PANE_MIN_HEIGHT,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.input,
  },
  input: {
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.md,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
    color: theme.desktop.foreground,
    fontFamily: theme.fonts.mono.regular,
    fontWeight: "400",
    fontSize: 13,
    lineHeight: 24,
    variants: {
      focused: {
        true: { borderColor: theme.desktop.ring },
        false: {},
      },
    },
  },
  preview: {
    padding: theme.space.md,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  skeleton: {
    gap: theme.space.md,
    padding: theme.space.md,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  skeletonLine: { height: 12, borderRadius: 4, backgroundColor: theme.desktop.secondary },
}));
