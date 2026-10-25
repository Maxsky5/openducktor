/**
 * The colors of the desktop file tree. Desktop draws it with `@pierre/trees`, which colors file
 * icons by kind and marks Git changes with these status colors. The desktop theme overrides only
 * the row text, the page, and the selection, which come from `theme.desktop`.
 */
import type { WorkspaceFileGitStatus } from "@openducktor/contracts";
import type { FileIconColor } from "./file-icons";

type Scheme = "light" | "dark";

/** `--trees-icon-*` of `@pierre/trees`. */
const ICON_COLORS = {
  light: {
    gray: "#84848a",
    red: "#d52c36",
    vermilion: "#ff8c5b",
    orange: "#d47628",
    yellow: "#d5a910",
    green: "#199f43",
    teal: "#17a5af",
    cyan: "#1ca1c7",
    blue: "#1a85d4",
    indigo: "#693acf",
    purple: "#a631be",
    pink: "#d32a61",
    mauve: "#594c5b",
  },
  dark: {
    gray: "#adadb1",
    red: "#ff6762",
    vermilion: "#d5512f",
    orange: "#ffa359",
    yellow: "#ffd452",
    green: "#5ecc71",
    teal: "#64d1db",
    cyan: "#68cdf2",
    blue: "#69b1ff",
    indigo: "#9d6afb",
    purple: "#d568ea",
    pink: "#ff678d",
    mauve: "#79697b",
  },
} as const satisfies Record<Scheme, Record<FileIconColor, string>>;

/** `--trees-*-light` and `--trees-*-dark` of `@pierre/trees`: the Git status colors. */
const GIT_STATUS_COLORS = {
  light: {
    added: "#16a994",
    deleted: "#ff2e3f",
    ignored: "#adadb1",
    modified: "#1ca1c7",
    renamed: "#d5a910",
    untracked: "#16a994",
  },
  dark: {
    added: "#00cab1",
    deleted: "#ff6762",
    ignored: "#4a4a4e",
    modified: "#08c0ef",
    renamed: "#ffd452",
    untracked: "#00cab1",
  },
} as const satisfies Record<Scheme, Record<WorkspaceFileGitStatus, string>>;

export type FileTreeColors = {
  icons: Record<FileIconColor, string>;
  gitStatus: Record<WorkspaceFileGitStatus, string>;
};

/** The file tree colors of each color scheme. Read them with `FILE_TREE_COLORS[theme.scheme]`. */
export const FILE_TREE_COLORS = {
  light: { icons: ICON_COLORS.light, gitStatus: GIT_STATUS_COLORS.light },
  dark: { icons: ICON_COLORS.dark, gitStatus: GIT_STATUS_COLORS.dark },
} as const satisfies Record<Scheme, FileTreeColors>;
