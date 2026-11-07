// A row of the command palette in command-palette-rows.tsx: a task, a chat, or an action. A task
// row shows its status dot, its kind, the title with the marks of the query, the attention, the
// workspace, the task ID, and the status. The data attributes give the footer hints of the row.
import {
  Archive,
  Bug,
  ChevronRight,
  Columns3,
  Copy,
  Download,
  FolderGit2,
  Import,
  MessageCirclePlus,
  MessageSquareText,
  MessagesSquare,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCcw,
  Reply,
  RotateCcw,
  RotateCcwClock,
  Settings,
  Sparkles,
  SquareCheckBig,
  Trash,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { PaletteIcon, PaletteRow as PaletteRowData } from "../../sample/palette";
import { WORKSPACES } from "../../sample/workspace";
import { flag } from "../flag";
import { RoleIcon } from "../ui/RoleIcon";
import { StatusDot } from "../ui/StatusDot";
import { StatusPill } from "../ui/StatusPill";
import { segments } from "./match";
import "../ui/AttentionPill.css";
import "./PaletteRow.css";

type PaletteRowProps = {
  row: PaletteRowData;
  selected?: boolean;
  /** The query whose marks the title and the task ID show. */
  query?: string;
};

const LUCIDE = {
  plus: Plus,
  "message-circle-plus": MessageCirclePlus,
  download: Download,
  import: Import,
  "columns-3": Columns3,
  settings: Settings,
  "folder-git-2": FolderGit2,
  "message-square-text": MessageSquareText,
  archive: Archive,
  "refresh-ccw": RefreshCcw,
  history: RotateCcwClock,
  pencil: Pencil,
  "panel-right-open": PanelRightOpen,
  copy: Copy,
  "rotate-ccw": RotateCcw,
  "trash-2": Trash,
  reply: Reply,
} satisfies Record<PaletteIcon, LucideIcon>;
const ISSUES = { task: SquareCheckBig, bug: Bug, feature: Sparkles };

const tile = (name: string): string => WORKSPACES.find((item) => item.name === name)?.tile ?? "";

/** The text with a mark on each part that the query finds. */
const marked = (text: string, query: string): ReactNode[] =>
  segments(text, query).map((part, index) =>
    part.marked ? <mark key={`${index}-${part.text}`}>{part.text}</mark> : part.text,
  );

export function PaletteRow({ row, selected = false, query = "" }: PaletteRowProps): ReactElement {
  const Lucide = row.kind === "action" && row.icon ? LUCIDE[row.icon] : undefined;
  const role = row.kind === "action" ? row.role : undefined;
  const Issue = row.kind === "task" ? ISSUES[row.issue] : null;
  const hints = row.kind === "action" ? { enter: "Run" } : row.hints;
  return (
    <div
      className="pal-row"
      data-kind={row.kind}
      data-selected={flag(selected)}
      data-destructive={flag(row.kind === "action" && row.destructive)}
      data-pal-row={row.id}
      data-enter={hints.enter}
      data-next={"next" in hints ? hints.next : undefined}
      data-edit={"edit" in hints ? hints.edit : undefined}
      data-tab={flag("tab" in hints && hints.tab)}
    >
      {row.kind === "action" ? (
        <span className="pal-icon">{role ? <RoleIcon role={role} /> : Lucide && <Lucide />}</span>
      ) : (
        <span className="pal-dot">{row.dot && <StatusDot state={row.dot} />}</span>
      )}
      {Issue && (
        <Issue className="pal-issue" data-issue={row.kind === "task" ? row.issue : undefined} />
      )}
      {row.kind === "chat" && (
        <span className="pal-icon">
          <MessagesSquare />
        </span>
      )}
      <span className="pal-title" data-pal-title="">
        {marked(row.kind === "action" ? row.label : row.title, query)}
      </span>
      {row.kind === "action" && row.scope && <span className="pal-muted">{`in ${row.scope}`}</span>}
      {row.kind === "action" && row.detail && <span className="pal-muted">{row.detail}</span>}
      {row.kind === "task" && row.attention && (
        <span className="attention-pill">{row.attention}</span>
      )}
      {row.kind !== "action" && <span className="pal-tile">{tile(row.workspace)}</span>}
      {row.kind === "task" && (
        <span className="pal-id" data-pal-id="">
          {marked(row.taskId, query)}
        </span>
      )}
      {row.kind === "task" && <StatusPill status={row.status} className="pal-status" />}
      {row.kind !== "action" && (
        <span className="pal-more">
          <ChevronRight />
        </span>
      )}
    </div>
  );
}
