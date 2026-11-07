// A session row of session-navigation-list.tsx. The first line shows the status dot, the
// workspace, the task status, and the attention pill or the time. The second line shows the role
// icon or the chat icon, the title, a terminal icon while a command runs, and the runtime.
import { Check, MessagesSquare, SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { RoleIcon } from "../ui/RoleIcon";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { StatusDot } from "../ui/StatusDot";
import { StatusPill } from "../ui/StatusPill";
import { navDot, type NavEntry, navTime, navTone } from "./nav";
import "../ui/AttentionPill.css";
import "./NavRow.css";

export function NavRow({ entry }: { entry: NavEntry }): ReactElement {
  const time = navTime(entry);
  return (
    <li className="nav-item" hidden={entry.later} data-nav-entry={entry.id}>
      <span className="nav-row" data-selected={flag(entry.selected)} data-nav-row="">
        <span className="nav-line">
          <StatusDot state={navDot(entry)} data-nav-dot />
          <span className="nav-ws">{entry.workspace}</span>
          <StatusPill status={entry.status} short className="nav-status" data-nav-status />
          <span className="attention-pill" hidden={!entry.attention} data-nav-attention="">
            {entry.attention}
          </span>
          <span className="nav-time" hidden={!time} data-nav-time="">
            {time}
          </span>
        </span>
        <span className="nav-line">
          <span className="nav-icon" data-tone={navTone(entry)} data-nav-icon="">
            {entry.role ? <RoleIcon role={entry.role} /> : <MessagesSquare />}
          </span>
          <span className="nav-title">{entry.title}</span>
          <span className="nav-commands" hidden={!entry.commands} data-nav-commands="">
            <SquareTerminal className="i14" />
          </span>
          <RuntimeIcon kind={entry.runtime} />
        </span>
        <span className="nav-check">
          <Check />
        </span>
      </span>
    </li>
  );
}
