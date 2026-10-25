import type { AgentFileSearchResultKind } from "@openducktor/core";
import { withAlpha } from "@/theme/color-alpha";
import type { AppTheme } from "@/theme/tokens";
import type { IconName } from "@/ui/icon";

/** The kinds of reference chip: the desktop file, skill, subagent, and Slash Command chips. */
export type ReferenceChipKind = "file" | "skill" | "subagent" | "slash_command";

/** The desktop file reference icon of each file kind. */
const FILE_ICONS = {
  directory: "folder-tree",
  css: "paintbrush",
  code: "file-code-2",
  image: "file-image",
  video: "file-play",
  default: "file-text",
} as const satisfies Record<AgentFileSearchResultKind, IconName>;

/** The desktop icon of a chip. A Slash Command chip has none. */
export const referenceChipIcon = (
  kind: ReferenceChipKind,
  fileKind: AgentFileSearchResultKind,
): IconName | null => {
  switch (kind) {
    case "file":
      return FILE_ICONS[fileKind];
    case "skill":
      return "blocks";
    case "subagent":
      return "bot";
    case "slash_command":
      return null;
  }
};

/**
 * The desktop chip colors. File: `bg-sky-200 dark:bg-sky-800`. Skill: the purple family. Subagent:
 * the teal family. Slash Command: `bg-yellow-300 dark:bg-yellow-600`. The mobile palette has no
 * purple, teal, or yellow family, so the chips use violet, cyan, and amber.
 */
export const referenceChipColors = (theme: AppTheme, kind: ReferenceChipKind) => {
  const { palette, desktop } = theme;
  const dark = theme.scheme === "dark";
  switch (kind) {
    case "file":
      return {
        backgroundColor: dark ? palette.sky800 : palette.sky200,
        borderColor: "transparent",
        color: desktop.secondaryForeground,
      };
    case "skill":
      return {
        backgroundColor: dark ? withAlpha(palette.violet950, 0.5) : palette.violet100,
        borderColor: dark ? palette.violet800 : palette.violet200,
        color: dark ? palette.violet200 : palette.violet800,
      };
    case "subagent":
      return {
        backgroundColor: dark ? withAlpha(palette.cyan950, 0.5) : palette.cyan100,
        borderColor: dark ? palette.cyan800 : palette.cyan200,
        color: dark ? palette.cyan200 : palette.cyan800,
      };
    case "slash_command":
      return {
        backgroundColor: dark ? palette.amber600 : palette.amber300,
        borderColor: "transparent",
        color: desktop.secondaryForeground,
      };
  }
};
