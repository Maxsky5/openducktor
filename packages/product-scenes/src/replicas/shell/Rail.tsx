// The workspace rail of components/layout/workspace-rail.tsx. The selected row takes the sidebar
// surface, so it joins the sidebar next to it. The badges over a tile show sessions that wait for
// input and running sessions, in the order of workspace-rail-activity-badges-model.ts.
import { Plus } from "lucide-react";
import type { ReactElement } from "react";
import { WORKSPACES } from "../../sample/workspace";
import { flag } from "../flag";
import { StatusDot } from "../ui/StatusDot";
import { type NavEntry, railBadges } from "./nav";
import "./Rail.css";

type RailProps = {
  /** The sessions of the sidebar, which give the badges of each tile. */
  entries: readonly NavEntry[];
};

export function Rail({ entries }: RailProps): ReactElement {
  return (
    <div className="rail">
      {WORKSPACES.map((workspace, index) => {
        const badges = railBadges(entries, workspace.name);
        return (
          <span className="rail-row" data-selected={flag(index === 0)} key={workspace.name}>
            <span
              className="tile"
              data-selected={flag(index === 0)}
              data-rail-tile={workspace.name}
            >
              {workspace.tile}
              <span className="tile-badges">
                <i className="tile-badge input" hidden={!badges.input} data-rail-badge="input" />
                <StatusDot
                  state="running"
                  className="tile-badge"
                  hidden={!badges.running}
                  data-rail-badge="running"
                />
              </span>
            </span>
          </span>
        );
      })}
      <span className="rail-add">
        <Plus />
      </span>
    </div>
  );
}
