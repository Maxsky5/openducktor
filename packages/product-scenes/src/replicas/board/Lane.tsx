// KanbanColumn of kanban-column.tsx. An open lane without a card shows LaneEmptyState.
import { Inbox } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import { laneCountLabel } from "../format";
import { LANE_TITLES, type LaneId } from "../vocabulary";
import "./Lane.css";

type LaneProps = { status: LaneId; count: number; collapsed?: boolean; children?: ReactNode };

export function Lane({ status, count, collapsed = false, children }: LaneProps): ReactElement {
  return (
    <div className="lane" data-collapsed={flag(collapsed)} data-lane={status}>
      <div className="lane-head">
        <span className="lane-accent" />
        <div className="lane-title" data-lane-title="">
          <span className="lane-name">{LANE_TITLES[status]}</span>
          <span className="lane-count" data-lane-count="">
            {laneCountLabel(count)}
          </span>
        </div>
        <span className="lane-dot" data-lane-dot="">
          {count}
        </span>
      </div>
      <div className="lane-body" data-lane-body="">
        <div className="lane-empty">
          <Inbox />
          <p>No tasks in this lane.</p>
        </div>
        {children}
      </div>
      <span className="lane-rail" data-lane-rail="" />
    </div>
  );
}
