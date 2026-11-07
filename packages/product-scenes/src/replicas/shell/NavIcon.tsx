// A session icon of session-navigation-rail.tsx in the collapsed sidebar: the role icon or the
// chat icon on the surface of its group, with the status dot on its corner.
import { Check, MessagesSquare } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { RoleIcon } from "../ui/RoleIcon";
import { StatusDot } from "../ui/StatusDot";
import { navDot, type NavEntry, navTone } from "./nav";
import "./NavRow.css";
import "./NavIcon.css";

export function NavIcon({ entry }: { entry: NavEntry }): ReactElement {
  return (
    <li className="sbc-item" hidden={entry.later} data-nav-entry={entry.id}>
      <span className="nav-row sbc-entry" data-selected={flag(entry.selected)} data-nav-row="">
        <span className="nav-icon" data-tone={navTone(entry)} data-nav-icon="">
          {entry.role ? <RoleIcon role={entry.role} /> : <MessagesSquare />}
        </span>
        <StatusDot state={navDot(entry)} className="sbc-dot" data-nav-dot />
        <span className="nav-check">
          <Check />
        </span>
      </span>
    </li>
  );
}
