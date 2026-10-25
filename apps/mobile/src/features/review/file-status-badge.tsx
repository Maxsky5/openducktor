import type { GitFileDiff } from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon, type IconName } from "@/ui/icon";
import { gitPanelColors } from "./review-colors";

/** The desktop file icon of each Git change. Other changes, such as a rename, show a text file. */
const STATUS_ICONS = {
  modified: "file-text",
  added: "file-plus",
  deleted: "file-x",
  renamed: "file-text",
  submodule: "folder-git-2",
} satisfies Record<GitFileDiff["type"], IconName>;

/**
 * The file icon of a changed file, in its desktop status color. The row names the status for
 * screen readers, and the icon shape shows it without color.
 */
export const FileStatusIcon = memo(function FileStatusIcon({
  changeType,
  size = 16,
}: {
  changeType: GitFileDiff["type"];
  size?: number | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const colors = gitPanelColors(theme);
  const color =
    changeType === "added"
      ? colors.added
      : changeType === "deleted"
        ? colors.deleted
        : changeType === "renamed"
          ? theme.desktop.mutedForeground
          : colors.modified;
  return <Icon name={STATUS_ICONS[changeType]} size={size} colorValue={color} />;
});
