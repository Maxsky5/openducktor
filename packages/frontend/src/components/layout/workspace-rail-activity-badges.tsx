import { Activity, CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import type { WorkspaceActivityState } from "@/features/workspace-activity/workspace-activity-state";

const WORKSPACE_ACTIVITY_LABELS = {
  inputRequired: "Sessions waiting for input",
  active: "Sessions running",
  error: "Sessions failed",
  unavailable: "Session activity unavailable",
} as const;

type WorkspaceActivityBadgeKey = "inputRequired" | "error" | "active";

export type WorkspaceActivityBadge = {
  key: WorkspaceActivityBadgeKey;
  /** Hover text and assistive text. It names the state and gives no count. */
  label: string;
};

/**
 * Badge icons, matching the Agent activity card of the sidebar.
 *
 * The error glyph is new, because a failed session is marked by a plain dot
 * inside a workspace today.
 */
const WORKSPACE_ACTIVITY_ICONS = {
  inputRequired: <CircleAlert className="size-[0.8rem] text-warning-accent" />,
  error: <TriangleAlert className="size-[0.8rem] text-destructive" />,
  active: (
    <Activity className="workspace-rail-status-running-icon size-[0.8rem] text-info-accent" />
  ),
} satisfies Record<WorkspaceActivityBadgeKey, ReactElement>;

/** Left to right: input required, then error, then active. */
export const workspaceActivityBadges = (
  activity: WorkspaceActivityState,
): readonly WorkspaceActivityBadge[] => {
  if (activity.kind === "unknown") {
    return [];
  }
  if (activity.kind === "unavailable") {
    return [
      { key: "error", label: `${WORKSPACE_ACTIVITY_LABELS.unavailable}: ${activity.reason}` },
    ];
  }

  const badges: WorkspaceActivityBadge[] = [];
  if (activity.inputRequired) {
    badges.push({ key: "inputRequired", label: WORKSPACE_ACTIVITY_LABELS.inputRequired });
  }
  if (activity.error) {
    badges.push({ key: "error", label: WORKSPACE_ACTIVITY_LABELS.error });
  }
  if (activity.active) {
    badges.push({ key: "active", label: WORKSPACE_ACTIVITY_LABELS.active });
  }
  return badges;
};

/**
 * Activity badges of one workspace tile.
 *
 * The strip is absolutely positioned inside the tile button, so it changes no
 * tile size and no rail spacing, and every pointer event still reaches the
 * button. It straddles the top edge of the tile, half over the tile and half
 * over the gap above it, which keeps it clear of the workspace icon.
 */
export function WorkspaceRailActivityBadges({
  badges,
  describedById,
}: {
  badges: readonly WorkspaceActivityBadge[];
  describedById: string;
}): ReactElement | null {
  if (badges.length === 0) {
    return null;
  }

  return (
    <span
      id={describedById}
      className="absolute right-0 top-0 inline-flex -translate-y-1/2 items-start -space-x-0.5"
      data-testid="workspace-rail-activity-badges"
    >
      {badges.map((badge) => (
        <span
          key={badge.key}
          className="inline-flex size-[0.8rem] items-center justify-center rounded-full bg-background"
          title={badge.label}
        >
          <span aria-hidden="true" className="inline-flex items-center justify-center">
            {WORKSPACE_ACTIVITY_ICONS[badge.key]}
          </span>
          <span className="sr-only">{badge.label}</span>
        </span>
      ))}
    </span>
  );
}
