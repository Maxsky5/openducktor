import type { ReactNode } from "react";
import { LANE_LABELS, type LaneId } from "@/lib/lanes";

/**
 * A board lane or a task badge, as a pill in the color of the lane. The text and the diagrams use
 * it. `children` replaces the lane title, such as a state inside a lane.
 */
export function LanePill({ lane, children }: { lane: LaneId; children?: ReactNode }) {
  return (
    <span className="docs-lane" data-docs-lane={lane}>
      {children ?? LANE_LABELS[lane]}
    </span>
  );
}
