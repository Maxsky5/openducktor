// The command palette of command-palette-dialog.tsx over the window: the input row, the result
// list, and the footer. It opens and closes at once, without motion, as the product does. A view
// shows one list: the home list before you type, the search results, the actions of a task, or
// the reply to a question. The markup holds the search results of the query.
import { ArrowLeft, ChevronDown, Layers, Plus, Search } from "lucide-react";
import type { ReactElement } from "react";
import {
  type PaletteRow as PaletteRowData,
  QUERY,
  SEARCH_ROWS,
  SEARCH_TARGET,
  SUGGESTED,
  TARGET_ACTIONS,
  WAITING_ACTIONS,
  WAITING_TASK,
} from "../../sample/palette";
import type { KeyLabels } from "../keys";
import { matchesQuery } from "./match";
import { PaletteFooter } from "./PaletteFooter";
import { PaletteReply } from "./PaletteReply";
import { PaletteRow } from "./PaletteRow";
import "./Palette.css";

type PaletteProps = {
  /** The keys of the footer hints. */
  keys: KeyLabels;
  /** The task actions list Reset Task and Delete task. A short palette leaves them out. */
  destructive?: boolean;
};

/** The texts that the search reads in a row: the title, and the ID of a task. */
const texts = (row: PaletteRowData): string[] =>
  row.kind === "task" ? [row.title, row.taskId] : [row.kind === "chat" ? row.title : row.label];

const GROUPS = [
  { label: "Tasks", kind: "task" },
  { label: "Sessions", kind: "chat" },
  { label: "Actions", kind: "action" },
] as const;

export function Palette({ keys, destructive = true }: PaletteProps): ReactElement {
  const found = SEARCH_ROWS.filter((row) => matchesQuery(texts(row), QUERY));
  const target = SEARCH_ROWS.find((row) => row.id === SEARCH_TARGET);
  if (!target || target.kind !== "task") throw new Error("The palette needs its target task.");
  const targetActions = TARGET_ACTIONS.filter((row) => destructive || !row.destructive);
  return (
    <div className="pal-overlay" data-palette="">
      <div className="pal" data-view="search" data-pal="">
        <div className="pal-head">
          <span className="pal-search">
            <Search />
          </span>
          <span className="pal-chip" data-pal-chip="">
            <span className="pal-back">
              <ArrowLeft />
            </span>
            <span className="pal-chip-tile">FI</span>
            <span className="pal-chip-title" data-pal-chip-title="">
              {target.title}
            </span>
          </span>
          <span className="pal-input">
            <span className="typed" data-pal-query="">
              {QUERY}
            </span>
            <span className="pal-placeholder" data-pal-placeholder="">
              Search actions, tasks, and sessions…
            </span>
          </span>
          <span className="pal-scope">
            <Layers className="i14" />
            All workspaces
            <ChevronDown className="i14" />
          </span>
        </div>
        <div className="pal-list" data-pal-list="home">
          <div className="pal-group">
            <p>Needs you</p>
            <PaletteRow row={WAITING_TASK} selected />
          </div>
          <div className="pal-group">
            <p>Actions</p>
            {SUGGESTED.map((row) => (
              <PaletteRow row={row} key={row.id} />
            ))}
          </div>
        </div>
        <div className="pal-list" data-pal-list="search">
          {GROUPS.map((group) => (
            <div
              className="pal-group"
              hidden={!found.some((row) => row.kind === group.kind)}
              data-pal-group={group.kind}
              key={group.kind}
            >
              <p>{group.label}</p>
              {SEARCH_ROWS.filter((row) => row.kind === group.kind).map((row) => (
                <div
                  hidden={!found.includes(row)}
                  data-pal-text={texts(row).join("\n")}
                  key={row.id}
                >
                  <PaletteRow row={row} query={QUERY} selected={row.id === SEARCH_TARGET} />
                </div>
              ))}
            </div>
          ))}
          <div className="pal-group" data-pal-group="create">
            <p>Create</p>
            <div className="pal-row" data-kind="action" data-enter="Run" data-pal-row="create">
              <span className="pal-icon">
                <Plus />
              </span>
              <span className="pal-title">
                New task “<span data-pal-create="">{QUERY}</span>”
              </span>
              <span className="pal-muted">in fieldnotes</span>
            </div>
          </div>
        </div>
        <div className="pal-list" data-pal-list="target">
          <div className="pal-group">
            <p>Task actions</p>
            {targetActions.map((row, index) => (
              <PaletteRow row={row} selected={index === 0} key={row.id} />
            ))}
          </div>
        </div>
        <div className="pal-list" data-pal-list="waiting">
          <div className="pal-group">
            <p>Task actions</p>
            {WAITING_ACTIONS.map((row, index) => (
              <PaletteRow row={row} selected={index === 0} key={row.id} />
            ))}
          </div>
        </div>
        <PaletteReply />
        <PaletteFooter
          enter={target.hints.enter}
          keys={keys}
          next={target.hints.next}
          edit={target.hints.edit}
        />
      </div>
    </div>
  );
}
