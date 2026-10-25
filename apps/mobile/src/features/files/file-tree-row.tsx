import { memo, type ReactElement } from "react";
import { type DimensionValue, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { TextPlaceholder } from "@/ui/placeholders";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { fileIcon } from "./file-icons";
import { FILE_TREE_COLORS } from "./file-tree-colors";
import { FILE_GIT_STATUS_PRESENTATION, type FileTreeRow, formatFileSize } from "./file-tree-model";

const ICON_SIZE = 16;
/** The width of the Git lane at the end of a row: a status letter or a change dot. */
const GIT_LANE_WIDTH = 16;

const rowDetail = (row: FileTreeRow): string | null => {
  if (row.kind === "directory") {
    return `${row.childCount ?? 0} ${row.childCount === 1 ? "item" : "items"}`;
  }
  const size = row.size === null ? null : formatFileSize(row.size);
  if (row.directory === null) return size;
  const folder = row.directory === "" ? "Top folder" : row.directory;
  return size ? `${folder} · ${size}` : folder;
};

const rowLabel = (row: FileTreeRow): string => {
  const git = row.gitStatus ? FILE_GIT_STATUS_PRESENTATION[row.gitStatus] : null;
  return [
    `${row.kind === "directory" ? "Folder" : "File"} ${row.name}`,
    rowDetail(row),
    git?.label ?? null,
    row.changed ? "Holds changes" : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
};

/**
 * One row of the desktop file tree: a folder chevron or a colored file icon, the name, and the
 * Git lane. A changed entry takes the color of its Git status and shows its status letter. A
 * folder that holds changes shows a dot. A search result names its folder under the name.
 */
export const FileTreeRowView = memo(function FileTreeRowView({
  row,
  selected,
  onPress,
}: {
  row: FileTreeRow;
  /** True for the file that the detail pane of a wide screen shows. */
  selected: boolean;
  onPress: (row: FileTreeRow) => void;
}): ReactElement {
  const theme = useAppTheme();
  const colors = FILE_TREE_COLORS[theme.scheme];
  const isDirectory = row.kind === "directory";
  const result = row.directory !== null;
  const statusColor = row.gitStatus ? colors.gitStatus[row.gitStatus] : null;
  const icon = isDirectory ? null : fileIcon(row.name);
  return (
    <Touchable
      feedback="highlight"
      onPress={() => onPress(row)}
      radius={theme.radius.sm}
      accessibilityRole="button"
      accessibilityLabel={rowLabel(row)}
      accessibilityHint={isDirectory ? "Opens the folder." : "Opens the file."}
      accessibilityState={isDirectory ? {} : { selected }}
      containerStyle={[styles.box, selected ? styles.selectedBox : null]}
      style={[styles.row, result ? styles.resultRow : styles.treeRow]}
    >
      <View style={[styles.icon, row.gitStatus === "ignored" && styles.ignoredIcon]}>
        {icon ? (
          <Icon
            name={icon.icon}
            size={ICON_SIZE}
            colorValue={statusColor ?? colors.icons[icon.color]}
          />
        ) : (
          <Icon name="chevron-right" size={ICON_SIZE} colorValue={theme.desktop.mutedForeground} />
        )}
      </View>
      <View style={styles.body}>
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          style={statusColor ? { color: statusColor } : null}
        >
          {row.name}
        </Text>
        {result ? (
          <Text variant="monoSmall" tone="tertiary" numberOfLines={1} ellipsizeMode="middle">
            {row.directory === "" ? "Top folder" : row.directory}
          </Text>
        ) : null}
      </View>
      <GitLane row={row} statusColor={statusColor} dotColor={colors.gitStatus.modified} />
    </Touchable>
  );
});

/**
 * A tree row for the first load: the icon and a bar in place of the name. It uses the row styles,
 * so the loaded tree takes its exact place.
 */
export function FileTreeRowPlaceholder({ nameWidth }: { nameWidth: DimensionValue }): ReactElement {
  return (
    <View style={styles.box}>
      <View style={[styles.row, styles.treeRow]}>
        <View style={styles.icon}>
          <View style={styles.placeholderIcon} />
        </View>
        <View style={styles.body}>
          <TextPlaceholder width={nameWidth} />
        </View>
        <View style={styles.gitLane} />
      </View>
    </View>
  );
}

/** The Git lane: the status letter of a changed entry, or a dot for a folder that holds changes. */
function GitLane({
  row,
  statusColor,
  dotColor,
}: {
  row: FileTreeRow;
  statusColor: string | null;
  dotColor: string;
}): ReactElement {
  const letter = row.gitStatus ? FILE_GIT_STATUS_PRESENTATION[row.gitStatus].letter : null;
  return (
    <View style={styles.gitLane}>
      {letter && statusColor ? (
        <Text variant="footnote" weight="semibold" style={{ color: statusColor }}>
          {letter}
        </Text>
      ) : row.changed ? (
        <View style={[styles.changeDot, { backgroundColor: dotColor }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The rows sit inset, so a selected row shows as a rounded wash, as in the desktop tree.
  box: {
    marginHorizontal: theme.space.sm,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
  },
  // A list renders many rows, so each picks plain style entries instead of stylesheet variants,
  // which run native code on each render.
  selectedBox: { backgroundColor: theme.desktop.selectedSurface },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.sm,
  },
  resultRow: { minHeight: 46, paddingVertical: theme.space.xs },
  // A dense list row: the tree shows more of the project, and a full-width row stays easy to tap.
  treeRow: { minHeight: 40 },
  icon: { width: ICON_SIZE, alignItems: "center" },
  ignoredIcon: { opacity: 0.5 },
  body: { flex: 1, minWidth: 0, gap: 1 },
  gitLane: { width: GIT_LANE_WIDTH, alignItems: "center", justifyContent: "center" },
  // The desktop tree draws the dot of a folder with changes at half strength.
  changeDot: { width: 6, height: 6, borderRadius: 3, opacity: 0.5 },
  placeholderIcon: { width: 14, height: 14, borderRadius: 4, backgroundColor: theme.colors.fill },
}));
