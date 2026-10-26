import type {
  PullRequestReviewAggregateStatus,
  PullRequestReviewState,
} from "@openducktor/contracts";
import type { checkBadgeVariant } from "@openducktor/frontend-core/review/task-execution-ci-presentation";
import type { AppTheme } from "@/theme/tokens";
import type { IconName } from "@/ui/icon";

/** The desktop badge variants that the CI Checks view uses. `info` is the pending check wash. */
export type CiBadgeVariant = "secondary" | "outline" | "success" | "warning" | "danger" | "info";

export type CiBadgeColors = { background: string; text: string; border: string };

/** The colors of each desktop badge variant, from `badge-variants.ts`. */
export const ciBadgeColors = (theme: AppTheme, variant: CiBadgeVariant): CiBadgeColors => {
  const { desktop } = theme;
  switch (variant) {
    case "secondary":
      return {
        background: desktop.secondary,
        text: desktop.secondaryForeground,
        border: "transparent",
      };
    case "outline":
      return { background: "transparent", text: desktop.foreground, border: desktop.input };
    case "success":
      return {
        background: desktop.successSurface,
        text: desktop.successSurfaceForeground,
        border: "transparent",
      };
    case "warning":
      return {
        background: desktop.warningSurface,
        text: desktop.warningSurfaceForeground,
        border: "transparent",
      };
    case "danger":
      return {
        background: desktop.destructiveSurface,
        text: desktop.destructiveSurfaceForeground,
        border: "transparent",
      };
    case "info":
      return {
        background: desktop.infoSurface,
        text: desktop.infoSurfaceForeground,
        border: "transparent",
      };
  }
};

/** The desktop text color families of a check status: `text-success-muted` and the others. */
export type CiStatusText = "success" | "destructive" | "info" | "muted";

export const ciStatusTextColor = (theme: AppTheme, status: CiStatusText): string => {
  switch (status) {
    case "success":
      return theme.desktop.successMuted;
    case "destructive":
      return theme.desktop.destructiveMuted;
    case "info":
      return theme.desktop.infoMuted;
    case "muted":
      return theme.desktop.mutedForeground;
  }
};

/** The header badge and summary color of each aggregate status, as `task-execution-ci-checks-list`. */
export const AGGREGATE_STATUS_PRESENTATION = {
  failure: { badge: "danger", text: "destructive" },
  neutral: { badge: "secondary", text: "muted" },
  pending: { badge: "info", text: "info" },
  success: { badge: "success", text: "success" },
  unknown: { badge: "secondary", text: "muted" },
} as const satisfies Record<
  PullRequestReviewAggregateStatus,
  { badge: CiBadgeVariant; text: CiStatusText }
>;

/** The status icon and color of a check, as `task-execution-ci-check-card`. */
export const CHECK_STATUS_PRESENTATION = {
  danger: { icon: "x-circle", text: "destructive" },
  info: { icon: "clock", text: "info" },
  secondary: { icon: "circle-dashed", text: "muted" },
  success: { icon: "circle-check", text: "success" },
} as const satisfies Record<
  ReturnType<typeof checkBadgeVariant>,
  { icon: IconName; text: CiStatusText }
>;

/** The pull request status of the desktop pull request link: a status icon and its color. */
export const PULL_REQUEST_STATE_PRESENTATION = {
  open: { label: "Open", icon: "git-pull-request" },
  draft: { label: "Draft", icon: "git-pull-request-draft" },
  merged: { label: "Merged", icon: "git-merge" },
  closed: { label: "Closed", icon: "git-pull-request-closed" },
} as const satisfies Record<PullRequestReviewState, { label: string; icon: IconName }>;

/**
 * The icon color of a pull request status: emerald, zinc, violet, or rose 600 in light mode and
 * 400 in dark mode. The mobile palette has no zinc, so a draft uses the slate step.
 */
export const pullRequestStateColor = (theme: AppTheme, state: PullRequestReviewState): string => {
  const light = theme.scheme === "light";
  const { palette } = theme;
  switch (state) {
    case "open":
      return light ? palette.emerald600 : palette.emerald400;
    case "draft":
      return light ? palette.slate600 : palette.slate400;
    case "merged":
      return light ? palette.violet600 : palette.violet400;
    case "closed":
      return light ? palette.rose600 : palette.rose400;
  }
};
