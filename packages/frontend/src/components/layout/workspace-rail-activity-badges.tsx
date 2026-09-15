import { Circle, CircleAlert, TriangleAlert } from "lucide-react";
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
 * Badge icons, matching the indicators the Agent Studio task tabs already use.
 *
 * The error glyph is new, because a failed session is marked by a plain dot
 * inside a workspace today.
 */
const WORKSPACE_ACTIVITY_ICONS = {
  inputRequired: <CircleAlert className="size-4 text-warning-accent" />,
  error: <TriangleAlert className="size-4 text-destructive" />,
  active: (
    <span className="workspace-rail-status-running-dot">
      <Circle className="size-3 fill-status-running text-status-running" />
    </span>
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
 * button. A 16px badge is taller than the 8px band above the 24px avatar box,
 * so the strip overlaps the top of the workspace icon, as a corner badge does.
 * The badges overlap each other just enough that three still fit the 40px tile.
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
      className="absolute right-0 top-0 inline-flex items-start -space-x-1"
      data-testid="workspace-rail-activity-badges"
    >
      {badges.map((badge) => (
        <span
          key={badge.key}
          className="inline-flex size-4 items-center justify-center rounded-full bg-background"
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
