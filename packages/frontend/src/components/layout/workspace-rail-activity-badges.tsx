import type { ReactElement } from "react";
import { RunningStatusDot } from "@/components/ui/running-status-dot";
import { cn } from "@/lib/utils";
import type { WorkspaceActivityBadge } from "./workspace-rail-activity-badges-model";

/**
 * Badge fill for session activity and workspace activity availability.
 *
 * The badges carry no glyph, so the tile states are told apart by color, and
 * the hover text and assistive text of each badge name the state in full.
 */
const WORKSPACE_ACTIVITY_BADGE_COLORS = {
  inputRequired: "bg-warning-accent",
  error: "bg-destructive",
  active: "inline-flex",
  unavailable: "bg-info-accent",
} satisfies Record<WorkspaceActivityBadge["key"], string>;

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
          {badge.key === "active" ? <RunningStatusDot size="sm" /> : null}
          <span className="sr-only">{badge.label}</span>
        </span>
      ))}
    </span>
  );
}
