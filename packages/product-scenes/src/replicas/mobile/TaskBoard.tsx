// The Tasks tab of the mobile app on a phone, as task-board-screen.tsx and board-pager.tsx in
// apps/mobile/src/features/tasks/board: the header with the workspace title, the task actions,
// and the search, then the lane switcher, then one page for each lane on the wash of the shown
// lane, and the tab bar. board-pager.ts swipes the pages.
import { ChevronsUpDown, Ellipsis, Search } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { WORKSPACE, WORKSPACES } from "../../sample/workspace";
import type { TaskKey } from "../../sample/tasks";
import type { LaneId } from "../vocabulary";
import { LaneSwitcher, PHONE_LANES } from "./LaneSwitcher";
import { MobileScreen } from "./MobileScreen";
import { type CardStart, MobileTaskCard } from "./MobileTaskCard";
import { TabBar } from "./TabBar";
import "./TaskBoard.css";

/** A card of a lane page: the task and its next workflow action. */
export type BoardCard = { task: TaskKey; start: CardStart; card?: string };

type TaskBoardProps = {
  /** The number of tasks in each lane. */
  counts: Readonly<Record<LaneId, number>>;
  /** The cards of the lanes that the scene shows. The other pages stay empty. */
  cards: Partial<Record<LaneId, readonly BoardCard[]>>;
  /** The index of the lane that the board shows. */
  selected: number;
  hidden?: boolean | undefined;
};

/** WorkspaceHeaderTitle: the active tile of the desktop rail, the name, and the chevrons. */
function WorkspaceTitle(): ReactElement {
  return (
    <span className="mob-board-workspace">
      <span className="mob-board-tile">{WORKSPACES[0].tile}</span>
      <span className="mob-board-name">{WORKSPACE}</span>
      <ChevronsUpDown />
    </span>
  );
}

export function TaskBoard({ counts, cards, selected, hidden }: TaskBoardProps): ReactElement {
  const progress: CSSProperties & { "--lane-progress": number } = { "--lane-progress": selected };
  return (
    <MobileScreen id="tasks" hidden={hidden}>
      <header className="mob-board-head">
        <WorkspaceTitle />
        <span className="mob-board-icon">
          <Ellipsis />
        </span>
        <span className="mob-board-icon">
          <Search />
        </span>
      </header>
      <LaneSwitcher counts={counts} selected={selected} />
      <div className="mob-board" data-tone={PHONE_LANES[selected]?.tone} data-board="">
        <div className="mob-board-pages" style={progress} data-board-pages="">
          {PHONE_LANES.map((lane) => (
            <div key={lane.id} className="mob-board-page" data-lane-page={lane.id}>
              {cards[lane.id]?.map((card) => (
                <MobileTaskCard key={card.task} {...card} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <TabBar selected="tasks" needsYou={0} />
    </MobileScreen>
  );
}
