import {
  FileDiff,
  FileText,
  FolderTree,
  ListChecks,
  type LucideIcon,
  SquareTerminal,
} from "lucide-react";

export type PanelId = "right" | "bottom";
export type SessionOwnerKind = "task" | "chat";

/** Tool kinds in default tab order. A tool tab shows a view of the task or chat. */
export const TOOL_TAB_KINDS = ["document", "diffs", "files", "ci_checks"] as const;
export type ToolTabKind = (typeof TOOL_TAB_KINDS)[number];

/** All kinds in launcher order. */
export const PANEL_TAB_KINDS = [...TOOL_TAB_KINDS, "terminal"] as const;
export type PanelTabKind = (typeof PANEL_TAB_KINDS)[number];

export type PanelTabKindRule = {
  label: string;
  /** One line that tells what the tab shows, for the New tab launcher. */
  description: string;
  icon: LucideIcon;
  /** `unique` kinds have at most one tab in an owner layout, in all panels together. */
  cardinality: "unique" | "many";
  panels: readonly PanelId[];
  owners: readonly SessionOwnerKind[];
  openByDefault: boolean;
  /** Keeps the tab content mounted while another tab is selected. */
  keepMounted: boolean;
};

/** The one place that names a tab kind. A later kind adds its name above, a rule here, and a renderer. */
export const PANEL_TAB_KIND_RULES = {
  document: {
    label: "Document",
    description: "Read the spec, the plan, and the QA report.",
    icon: FileText,
    cardinality: "unique",
    panels: ["right"],
    owners: ["task"],
    openByDefault: true,
    keepMounted: false,
  },
  diffs: {
    label: "Diffs",
    description: "Review the code changes.",
    icon: FileDiff,
    cardinality: "unique",
    panels: ["right"],
    owners: ["task", "chat"],
    openByDefault: true,
    keepMounted: false,
  },
  files: {
    label: "Files",
    description: "Browse the files and open one.",
    icon: FolderTree,
    cardinality: "unique",
    panels: ["right"],
    owners: ["task", "chat"],
    openByDefault: true,
    keepMounted: true,
  },
  ci_checks: {
    label: "CI Checks",
    description: "Follow the checks of the pull request.",
    icon: ListChecks,
    cardinality: "unique",
    panels: ["right"],
    owners: ["task"],
    openByDefault: true,
    keepMounted: false,
  },
  terminal: {
    label: "Terminal",
    description: "Run commands in a new shell.",
    icon: SquareTerminal,
    cardinality: "many",
    panels: ["right", "bottom"],
    owners: ["task", "chat"],
    openByDefault: false,
    keepMounted: true,
  },
} as const satisfies Record<PanelTabKind, PanelTabKindRule>;

export const isToolTabKind = (value: string): value is ToolTabKind =>
  TOOL_TAB_KINDS.some((kind) => kind === value);

export const PANEL_NAMES = {
  right: "right panel",
  bottom: "bottom panel",
} satisfies Record<PanelId, string>;
