// The workspace rail of components/layout/workspace-rail.tsx. The selected row takes the sidebar
// surface, so it joins the sidebar next to it. The badges over a tile show sessions that wait for
// input and running sessions, in the order of workspace-rail-activity-badges-model.ts. With
// `hintKeys`, each tile has the position hint of its workspace under it. The bottom of the rail
// holds the Processes button of processes-surfaces.tsx and the host button of host-connection.tsx
// for the local host.
import { Cpu, Laptop, Plus } from "lucide-react";
import type { ReactElement } from "react";
import { WORKSPACES } from "../../sample/workspace";
import { flag } from "../flag";
import type { KeyLabels } from "../keys";
import { StatusDot } from "../ui/StatusDot";
import { type NavEntry, positionHint, railBadges } from "./nav";
import { PositionHint } from "./PositionHint";
import "./Rail.css";

type RailProps = {
  /** The sessions of the sidebar, which give the badges of each tile. */
  entries: readonly NavEntry[];
  /** The keys of the position hints of the tiles. Without them, the tiles have no hint. */
  hintKeys?: KeyLabels | undefined;
  /** The Processes view. Without it, no command runs and the view is closed. */
  processes?: RailProcesses | undefined;
};

/**
 * The running commands of the open workspaces, and the view of the Processes button: closed, or
 * open as the flyout or the floating window.
 */
export type RailProcesses = { count: number; open: boolean };

const NO_PROCESSES: RailProcesses = { count: 0, open: false };

export function Rail({ entries, hintKeys, processes = NO_PROCESSES }: RailProps): ReactElement {
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
              {hintKeys && (
                <PositionHint
                  text={positionHint("workspace", index + 1, hintKeys)}
                  className="tile-hint"
                />
              )}
            </span>
          </span>
        );
      })}
      <span className="rail-add">
        <Plus />
      </span>
      <span className="rail-foot">
        <span className="rail-button" data-open={flag(processes.open)} data-processes="">
          <Cpu />
          {/* The open view shows the count in its toolbar, so the badge waits until it closes. */}
          <b
            className="process-badge"
            hidden={processes.count === 0 || processes.open}
            data-processes-badge=""
          >
            {processes.count}
          </b>
        </span>
        <span className="rail-button rail-host">
          <Laptop />
        </span>
      </span>
    </div>
  );
}
