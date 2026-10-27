import {
  type BuiltinIssueTypeId as IssueType,
  type BuiltinStateId as TaskStatus,
} from "@openducktor/workflows";
import type { PullRequest } from "@openducktor/contracts";
import { toPriorityLevel } from "@openducktor/frontend-core/tasks/board/kanban-task-badge-model";
import {
  statusTone,
  type TaskStatusTone,
} from "@openducktor/frontend-core/tasks/presentation/task-status-presentation";
import { withAlpha } from "@/theme/color-alpha";
import type { AppTheme } from "@/theme/tokens";

/** The colors of one desktop badge: its wash, outline, text, icon, and dot. */
export type ChipColors = {
  surface: string;
  border: string;
  text: string;
  icon: string;
  dot: string;
};

type PaletteName = keyof AppTheme["palette"];
type Family = "rose" | "orange" | "amber" | "sky" | "violet" | "emerald" | "indigo" | "cyan";

/**
 * The name of a desktop badge paint. A style resolves it in the current theme, so a theme change
 * repaints a badge without a render. `muted` is `border-border bg-muted text-foreground`. `card`
 * is `border-border bg-card text-muted-foreground`, and `card-strong` has the foreground text.
 * `task-type` is the muted Task type badge with a foreground icon.
 */
export type ChipPaint =
  | Family
  | "muted"
  | "card"
  | "card-strong"
  | "task-type"
  | `status-${TaskStatusTone}`;

/**
 * The Tailwind shades of a desktop badge family. Light: `bg-*-50 border-*-200 text-*-700`, icon
 * `*-600`. Dark: `bg-*-950/50 border-*-800 text-*-300`, icon `*-400`. Dots are `*-500` in both.
 */
const FAMILY_SHADES = {
  rose: ["rose50", "rose200", "rose700", "rose600", "rose950", "rose800", "rose300", "rose400"],
  orange: [
    "orange50",
    "orange200",
    "orange700",
    "orange600",
    "orange950",
    "orange800",
    "orange300",
    "orange400",
  ],
  amber: [
    "amber50",
    "amber200",
    "amber700",
    "amber600",
    "amber950",
    "amber800",
    "amber300",
    "amber400",
  ],
  sky: ["sky50", "sky200", "sky700", "sky600", "sky950", "sky800", "sky300", "sky400"],
  violet: [
    "violet50",
    "violet200",
    "violet700",
    "violet600",
    "violet950",
    "violet800",
    "violet300",
    "violet400",
  ],
  emerald: [
    "emerald50",
    "emerald200",
    "emerald700",
    "emerald600",
    "emerald950",
    "emerald800",
    "emerald300",
    "emerald400",
  ],
  indigo: [
    "indigo50",
    "indigo200",
    "indigo700",
    "indigo600",
    "indigo950",
    "indigo800",
    "indigo300",
    "indigo400",
  ],
  cyan: ["cyan50", "cyan200", "cyan700", "cyan600", "cyan950", "cyan800", "cyan300", "cyan400"],
} as const satisfies Record<Family, readonly PaletteName[]>;

const FAMILY_DOTS = {
  rose: "rose500",
  orange: "orange500",
  amber: "amber500",
  sky: "sky500",
  violet: "violet500",
  emerald: "emerald500",
  indigo: "indigo500",
  cyan: "cyan500",
} as const satisfies Record<Family, PaletteName>;

/** The colors of a desktop badge of one Tailwind family, in the current theme. */
const familyChipColors = (theme: AppTheme, family: Family): ChipColors => {
  const [soft, border, text, icon, darkSoft, darkBorder, darkText, darkIcon] =
    FAMILY_SHADES[family];
  const { palette } = theme;
  const dot = palette[FAMILY_DOTS[family]];
  return theme.scheme === "dark"
    ? {
        surface: withAlpha(palette[darkSoft], 0.5),
        border: palette[darkBorder],
        text: palette[darkText],
        icon: palette[darkIcon],
        dot,
      }
    : {
        surface: palette[soft],
        border: palette[border],
        text: palette[text],
        icon: palette[icon],
        dot,
      };
};

/** The desktop status badge colors, from the semantic status families of the desktop theme. */
const statusChipColors = (theme: AppTheme, tone: TaskStatusTone): ChipColors => {
  const d = theme.desktop;
  const semantic = (surface: string, border: string, text: string, dot: string): ChipColors => ({
    surface,
    border,
    text,
    icon: text,
    dot,
  });
  switch (tone) {
    case "neutral":
      return semantic(d.muted, d.input, d.foreground, d.mutedForeground);
    case "pending":
      return semantic(d.pendingSurface, d.pendingBorder, d.pendingMuted, d.pendingAccent);
    case "info":
      return semantic(d.infoSurface, d.infoBorder, d.infoMuted, d.infoAccent);
    case "warning":
      return semantic(d.warningSurface, d.warningBorder, d.warningMuted, d.warningAccent);
    case "destructive":
      return semantic(
        d.destructiveSurface,
        d.destructiveBorder,
        d.destructiveMuted,
        d.destructiveAccent,
      );
    case "success":
      return semantic(d.successSurface, d.successBorder, d.successMuted, d.successAccent);
    case "review":
      return familyChipColors(theme, "indigo");
    case "approval":
      return familyChipColors(theme, "cyan");
  }
};

/** The colors of a badge paint in the current theme. */
export const chipColors = (theme: AppTheme, paint: ChipPaint): ChipColors => {
  const d = theme.desktop;
  switch (paint) {
    case "muted":
    case "task-type":
      return {
        surface: d.muted,
        border: d.border,
        text: d.foreground,
        icon: paint === "task-type" ? d.foreground : d.mutedForeground,
        dot: d.mutedForeground,
      };
    case "card":
    case "card-strong":
      return {
        surface: d.card,
        border: d.border,
        text: paint === "card-strong" ? d.foreground : d.mutedForeground,
        icon: d.mutedForeground,
        dot: d.mutedForeground,
      };
    case "status-neutral":
      return statusChipColors(theme, "neutral");
    case "status-pending":
      return statusChipColors(theme, "pending");
    case "status-info":
      return statusChipColors(theme, "info");
    case "status-warning":
      return statusChipColors(theme, "warning");
    case "status-destructive":
      return statusChipColors(theme, "destructive");
    case "status-success":
      return statusChipColors(theme, "success");
    case "status-review":
      return statusChipColors(theme, "review");
    case "status-approval":
      return statusChipColors(theme, "approval");
    default:
      return familyChipColors(theme, paint);
  }
};

const ISSUE_TYPE_FAMILIES = {
  bug: "rose",
  feature: "sky",
  task: null,
} as const satisfies Record<IssueType, Family | null>;

/** The desktop issue type paint: Bug rose, Feature sky, and Task neutral. */
export const issueTypeChipPaint = (issueType: IssueType): ChipPaint =>
  ISSUE_TYPE_FAMILIES[issueType] ?? "task-type";

const PRIORITY_FAMILIES = {
  0: "rose",
  1: "orange",
  2: "amber",
  3: "sky",
  4: null,
} as const satisfies Record<ReturnType<typeof toPriorityLevel>, Family | null>;

/** The desktop priority paint: P0 rose, P1 orange, P2 amber, P3 sky, and P4 neutral. */
export const priorityChipPaint = (priority: number): ChipPaint =>
  PRIORITY_FAMILIES[toPriorityLevel(priority)] ?? "muted";

/** The desktop status badge paint, from the semantic status families of the desktop theme. */
export const statusChipPaint = (status: TaskStatus): ChipPaint => `status-${statusTone(status)}`;

/** The desktop pull request state icon colors: emerald, zinc, violet, and rose. */
export const pullRequestIconColor = (theme: AppTheme, state: PullRequest["state"]): string => {
  const dark = theme.scheme === "dark";
  const { palette } = theme;
  switch (state) {
    case "open":
      return dark ? palette.emerald400 : palette.emerald600;
    case "draft":
      return dark ? palette.slate400 : palette.slate600;
    case "merged":
      return dark ? palette.violet400 : palette.violet600;
    case "closed_unmerged":
      return dark ? palette.rose400 : palette.rose600;
  }
};
