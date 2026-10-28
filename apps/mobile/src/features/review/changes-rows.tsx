import { memo, type ReactElement, useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { ActionMenu, type ActionMenuHandle, type ActionMenuItem } from "@/ui/action-menu";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import type { ChangesRow } from "./changes-list-model";
import { type ChangedFileItem, type CollapsibleGroup, FILE_STATUS_LABELS } from "./changes-model";
import { FileStatusIcon } from "./file-status-badge";
import { LineCounts } from "./line-counts";
import { gitPanelColors } from "./review-colors";
import { lineCountAccessibilityLabel } from "./review-presentation";

/** The tree indent of each directory level, as the desktop 1rem on a narrower screen. */
const DEPTH_INDENT = 14;

type GroupRow = Extract<ChangesRow, { kind: "group" }>;

/**
 * A local change group header, as on desktop: a muted bar with the title and its file count.
 * Unstaged and Staged open and close; Conflicts always stays open and shows a warning icon.
 */
export const GroupHeader = memo(function GroupHeader({
  row,
  onToggle,
}: {
  row: GroupRow;
  onToggle: (group: CollapsibleGroup) => void;
}): ReactElement {
  const theme = useAppTheme();
  const content = (
    <>
      {row.open === null ? null : (
        <Icon
          name={row.open ? "chevron-down" : "chevron-right"}
          size={14}
          colorValue={theme.desktop.mutedForeground}
        />
      )}
      {row.group === "conflicted" ? (
        <Icon name="triangle-alert" size={14} colorValue={gitPanelColors(theme).conflict} />
      ) : null}
      <Text variant="footnote" weight="semibold" style={styles.groupTitle}>
        {row.title}
      </Text>
      <View style={styles.groupCount}>
        <Text variant="caption2" tabular style={styles.groupCountText}>
          {row.count}
        </Text>
      </View>
    </>
  );
  const label = `${row.title} changes, ${row.count} ${row.count === 1 ? "file" : "files"}`;
  const { group, open } = row;
  if (open === null || (group !== "unstaged" && group !== "staged")) {
    return (
      <View style={styles.group} accessible accessibilityRole="header" accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Touchable
      feedback="highlight"
      onPress={() => onToggle(group)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      style={styles.group}
    >
      {content}
    </Touchable>
  );
});

/** The text of an open group without files, such as "No staged changes". */
export const GroupEmpty = memo(function GroupEmpty({ text }: { text: string }): ReactElement {
  return (
    <View style={styles.empty}>
      <Text variant="footnote" style={styles.muted}>
        {text}
      </Text>
    </View>
  );
});

type DirectoryRowData = Extract<ChangesRow, { kind: "directory" }>;

/** A tree directory row with its file and line totals. A tap opens or closes it. */
export const DirectoryRow = memo(function DirectoryRow({
  row,
  onToggle,
}: {
  row: DirectoryRowData;
  onToggle: (directoryKey: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  const fileCountLabel = `${row.fileCount} changed ${row.fileCount === 1 ? "file" : "files"}`;
  return (
    <Touchable
      feedback="highlight"
      onPress={() => onToggle(row.directoryKey)}
      accessibilityRole="button"
      accessibilityLabel={`Folder ${row.path}, ${fileCountLabel}, ${lineCountAccessibilityLabel(row.additions, row.deletions)}`}
      accessibilityState={{ expanded: row.open }}
      style={[styles.directory, { paddingLeft: ROW_START + row.depth * DEPTH_INDENT }]}
    >
      <Icon
        name={row.open ? "chevron-down" : "chevron-right"}
        size={13}
        colorValue={theme.desktop.mutedForeground}
      />
      <Text variant="subhead" numberOfLines={1} ellipsizeMode="middle" style={styles.directoryName}>
        {row.name}
      </Text>
      <View style={styles.directoryCount}>
        <Text variant="caption2" tabular style={styles.directoryCountText}>
          {row.fileCount}
        </Text>
      </View>
      <LineCounts additions={row.additions} deletions={row.deletions} />
    </Touchable>
  );
});

/** The actions of a changed file in its menu. */
export type ChangedFileAction = "open-diff" | "view-file" | "copy-path";

type FileRowData = Extract<ChangesRow, { kind: "file" }>;

/**
 * A changed file, as the desktop file diff entry: a chevron, the status icon, the name with its
 * directory under it, the pending comment count, and the line counts. A tap shows or hides its
 * diff under the row. A long press, or the menu control of an open diff, shows the file actions.
 */
export const ChangedFileRow = memo(function ChangedFileRow({
  row,
  commentCount,
  onToggle,
  onAction,
}: {
  row: FileRowData;
  commentCount: number;
  onToggle: (file: ChangedFileItem) => void;
  onAction: (file: ChangedFileItem, action: ChangedFileAction) => void;
}): ReactElement {
  const theme = useAppTheme();
  const { file, expanded } = row;
  const menu = useRef<ActionMenuHandle>(null);
  const items = useMemo<ActionMenuItem[]>(
    () => [
      { id: "open-diff", title: "Open full diff", icon: "maximize-2" },
      ...(file.changeType === "deleted"
        ? []
        : [{ id: "view-file", title: "View file", icon: "eye" } satisfies ActionMenuItem]),
      { id: "copy-path", title: "Copy path", icon: "copy" },
    ],
    [file.changeType],
  );
  const select = useCallback(
    (id: string) => {
      if (id === "open-diff" || id === "view-file" || id === "copy-path") onAction(file, id);
    },
    [file, onAction],
  );
  const conflicted = file.status === "conflicted";
  const comments =
    commentCount > 0
      ? `, ${commentCount} pending ${commentCount === 1 ? "comment" : "comments"}`
      : "";
  const showsDirectory = row.showsDirectory && file.directory !== null;
  styles.useVariants({ tall: showsDirectory });
  return (
    <View style={styles.fileBox}>
      <ActionMenu title={file.name} items={items} onSelect={select} openOnLongPress menuRef={menu}>
        <Touchable
          feedback="highlight"
          onPress={() => onToggle(file)}
          accessibilityRole="button"
          accessibilityLabel={`${file.path}, ${FILE_STATUS_LABELS[file.status]}, ${lineCountAccessibilityLabel(file.additions, file.deletions)}${comments}`}
          accessibilityHint={expanded ? "Hides the diff." : "Shows the diff."}
          accessibilityState={{ expanded }}
          style={[styles.file, { paddingLeft: ROW_START + row.depth * DEPTH_INDENT }]}
        >
          <Icon
            name={expanded ? "chevron-down" : "chevron-right"}
            size={13}
            colorValue={theme.desktop.mutedForeground}
          />
          <FileStatusIcon changeType={file.changeType} />
          {conflicted ? (
            <Icon name="triangle-alert" size={15} colorValue={gitPanelColors(theme).conflict} />
          ) : null}
          <View style={styles.label}>
            <Text
              variant="subhead"
              weight="medium"
              numberOfLines={1}
              ellipsizeMode="middle"
              style={styles.name}
            >
              {file.name}
            </Text>
            {showsDirectory ? (
              <Text
                variant="monoSmall"
                numberOfLines={1}
                ellipsizeMode="middle"
                style={styles.muted}
              >
                {file.directory}
              </Text>
            ) : null}
          </View>
          {commentCount > 0 ? (
            <View style={styles.comments}>
              <Icon name="message-square" size={11} colorValue={theme.desktop.foreground} />
              <Text variant="caption2" tabular style={styles.commentCount}>
                {commentCount}
              </Text>
            </View>
          ) : null}
          <LineCounts additions={file.additions} deletions={file.deletions} />
          {expanded ? (
            <View style={styles.more}>
              <IconButton
                icon="more"
                size={18}
                color="secondaryLabel"
                accessibilityLabel={`More actions for ${file.path}`}
                onPress={() => menu.current?.show()}
              />
            </View>
          ) : null}
        </Touchable>
      </ActionMenu>
    </View>
  );
});

/** The start padding of a row before its tree indent. */
const ROW_START = 12;

const styles = StyleSheet.create((theme) => ({
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: theme.touchTarget,
    paddingLeft: ROW_START,
    paddingRight: theme.layout.screenPadding,
    borderTopWidth: theme.hairline,
    borderBottomWidth: theme.hairline,
    borderColor: withAlpha(theme.desktop.border, 0.6),
    backgroundColor: theme.colors.panelFill,
  },
  groupTitle: { color: theme.desktop.foreground },
  groupCount: {
    minWidth: 18,
    paddingHorizontal: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.desktop.background,
    alignItems: "center",
  },
  groupCountText: { fontSize: 11, color: theme.desktop.mutedForeground },
  empty: {
    alignItems: "center",
    paddingVertical: theme.space.lg,
    paddingHorizontal: theme.layout.screenPadding,
  },
  muted: { color: theme.desktop.mutedForeground },
  directory: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
    paddingRight: theme.layout.screenPadding,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.colors.diffDivider,
  },
  directoryName: { flex: 1, minWidth: 0, color: theme.desktop.foreground },
  directoryCount: {
    paddingHorizontal: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.desktop.muted,
    alignItems: "center",
  },
  directoryCountText: { fontSize: 11, color: theme.desktop.foreground },
  fileBox: {
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.colors.diffDivider,
  },
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingRight: theme.space.md,
    variants: {
      tall: {
        true: { minHeight: 52, paddingVertical: 6 },
        false: { minHeight: theme.touchTarget },
      },
    },
  },
  label: { flex: 1, minWidth: 0, gap: 1 },
  name: { color: theme.desktop.foreground },
  comments: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  commentCount: { fontSize: 11, color: theme.desktop.foreground },
  // The menu control keeps its touch area without making the row taller.
  more: { marginVertical: -8, marginRight: -theme.space.sm },
}));
