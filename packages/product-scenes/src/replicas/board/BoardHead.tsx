// The header of kanban-page-header.tsx: the board search field, the Labels, Type, and Priority
// filter buttons, the task card view control, and Refresh Tasks. The copy has no search text and no
// selection, so it shows no Clear button. A narrow stage and a compact header keep only the search
// field. A compact header fits a small board window without a sidebar: it is lower, and it leaves
// room for the window controls.
import { Blocks, Flag, RefreshCcw, Rows2, Rows3, Search, Tag } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { Button } from "../ui/Button";
import "./BoardHead.css";

const FILTERS = [
  { name: "Labels", Icon: Tag },
  { name: "Type", Icon: Blocks },
  { name: "Priority", Icon: Flag },
] as const;

export function BoardHead({ compact = false }: { compact?: boolean }): ReactElement {
  return (
    <div className="board-head" data-compact={flag(compact)}>
      <div className="board-filters">
        <span className="board-search">
          <Search />
          <span>Search tasks</span>
        </span>
        {FILTERS.map(({ name, Icon }) => (
          <Button variant="outline" size="sm" className="board-filter" key={name}>
            <Icon className="i14" />
            {name}
          </Button>
        ))}
      </div>
      <div className="board-actions">
        <span className="view-toggle">
          <span data-active="">
            <Rows2 className="i14" />
          </span>
          <span>
            <Rows3 className="i14" />
          </span>
        </span>
        <Button variant="outline" size="sm" className="board-refresh">
          <RefreshCcw className="i14" />
          Refresh Tasks
        </Button>
      </div>
    </div>
  );
}
