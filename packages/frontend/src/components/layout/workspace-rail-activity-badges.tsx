import type { ReactElement } from "react";
import type { WorkspaceActivityState } from "@/features/workspace-activity/workspace-activity-state";
import { cn } from "@/lib/utils";

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
 * Badge fill, matching the session status dots of the workspace sessions page.
 *
 * The badges carry no glyph, so the tile states are told apart by color, and
 * the hover text and assistive text of each badge name the state in full.
 */
const WORKSPACE_ACTIVITY_BADGE_COLORS = {
  inputRequired: "bg-warning-accent",
  error: "bg-destructive",
  active: "workspace-rail-status-running-dot bg-status-running",
} satisfies Record<WorkspaceActivityBadgeKey, string>;

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
 * button. It straddles the top edge of the tile: two thirds of a badge sit over
 * the tile and one third over the gap above it.
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
      className="absolute right-0 top-0 inline-flex -translate-y-1/3 items-start gap-0.5"
      data-testid="workspace-rail-activity-badges"
    >
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            WORKSPACE_ACTIVITY_BADGE_COLORS[badge.key],
          )}
          title={badge.label}
        >
          <span className="sr-only">{badge.label}</span>
        </span>
      ))}
    </span>
  );
}
