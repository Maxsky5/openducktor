// The lanes of the Kanban board. The track can be wider than the viewport, so a scene can move it.
// An empty lane is collapsed, as with the Collapsed display for empty columns.
import type { ReactElement } from "react";
import { flag } from "../flag";
import { LANES, type LaneId } from "../vocabulary";
import { Lane } from "./Lane";
import type { BoardData } from "./model";
import { TaskCard } from "./TaskCard";
import "./Board.css";

type BoardProps = {
  board: BoardData;
  /** The lanes that the view shows. A cropped board shows the first lanes only. */
  lanes?: readonly LaneId[];
  /**
   * The board scrolls only to places where no lane crosses an edge of the viewport. A small frame,
   * such as the tour of the app, shows a cut lane as a fault.
   */
  wholeLanes?: boolean;
};

export function Board({ board, lanes = LANES, wholeLanes = false }: BoardProps): ReactElement {
  return (
    <div className="board-viewport">
      <div className="board-track" data-board-track="" data-whole-lanes={flag(wholeLanes)}>
        {lanes.map((status) => {
          const cards = board[status] ?? [];
          return (
            <Lane status={status} count={cards.length} collapsed={cards.length === 0} key={status}>
              {cards.map((card) => (
                <TaskCard {...card} key={card.task} />
              ))}
            </Lane>
          );
        })}
      </div>
    </div>
  );
}
