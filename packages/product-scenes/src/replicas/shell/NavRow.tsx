// A session row of session-navigation-list.tsx. The first line shows the status dot, the
// workspace, the task status, the Draft or the Starting badge of a new workspace session, and the
// attention pill or the time. The second line shows the role icon or the chat icon, the title, a
// terminal icon while a command runs, and the runtime. A draft shows the icon of a new session in
// the place of the chat icon. A row with a position hint shows the hint in the place of the icon
// while the window shows the hints.
import { Check, MessageCirclePlus, MessagesSquare, SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { RoleIcon } from "../ui/RoleIcon";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { StatusDot } from "../ui/StatusDot";
import { StatusPill } from "../ui/StatusPill";
import { DRAFT_LABELS, navDot, type NavEntry, navTime, navTone } from "./nav";
import { PositionHint } from "./PositionHint";
import "../ui/AttentionPill.css";
import "./NavRow.css";

type NavRowProps = {
  entry: NavEntry;
  /** The text of the position hint of the row, from positionHint of nav.ts. */
  hint?: string | undefined;
};

/** The runtime of the row. A runtime that a later step gives shows only then. */
function RowRuntime({ entry }: { entry: NavEntry }): ReactElement | null {
  const kind = entry.runtime ?? entry.laterRuntime;
  if (!kind) return null;
  return (
    <span className="nav-runtime" hidden={!entry.runtime} data-nav-runtime="">
      <RuntimeIcon kind={kind} />
    </span>
  );
}

export function NavRow({ entry, hint }: NavRowProps): ReactElement {
  const time = navTime(entry);
  return (
    <li className="nav-item" hidden={entry.later} data-nav-entry={entry.id}>
      <span className="nav-row" data-selected={flag(entry.selected)} data-nav-row="">
        <span className="nav-line">
          <StatusDot state={navDot(entry)} data-nav-dot />
          <span className="nav-ws">{entry.workspace}</span>
          <StatusPill status={entry.status} short className="nav-status" data-nav-status />
          {!entry.role && (
            <span
              className="status-pill nav-status nav-draft"
              hidden={!entry.draft}
              data-draft={entry.draft}
              data-nav-draft=""
            >
              {entry.draft && DRAFT_LABELS[entry.draft]}
            </span>
          )}
          <span className="attention-pill" hidden={!entry.attention} data-nav-attention="">
            {entry.attention}
          </span>
          <span className="nav-time" hidden={!time} data-nav-time="">
            {time}
          </span>
        </span>
        <span className="nav-line">
          <span
            className="nav-icon"
            data-tone={navTone(entry)}
            data-draft={entry.draft}
            data-nav-icon=""
          >
            {entry.role ? (
              <RoleIcon role={entry.role} />
            ) : (
              <>
                <MessagesSquare className="nav-chat" />
                <MessageCirclePlus className="nav-new" />
              </>
            )}
            {hint !== undefined && <PositionHint text={hint} />}
          </span>
          <span className="nav-title" data-nav-title="">
            {entry.title}
          </span>
          <span className="nav-commands" hidden={!entry.commands} data-nav-commands="">
            <SquareTerminal className="i14" />
          </span>
          <RowRuntime entry={entry} />
        </span>
        <span className="nav-check" data-nav-check="">
          <Check />
        </span>
      </span>
    </li>
  );
}
