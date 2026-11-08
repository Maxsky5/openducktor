// A session row of the Sessions tab, as session-row.tsx in apps/mobile/src/features/sessions. The
// first line shows the read dot, the workspace, the task status, and what the session asks or the
// time. The second line shows the role or chat icon, the title, and the runtime mark. The card is
// amber while the session needs you and blue while it runs. session-groups.ts changes a row.
import { MessagesSquare } from "lucide-react";
import type { ReactElement } from "react";
import { type NavEntry, navDot, navTime, navTone } from "../shell/nav";
import { RoleIcon } from "../ui/RoleIcon";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { StatusDot } from "../ui/StatusDot";
import { MobileBadge } from "./MobileBadge";
import { rowSurface, titleTone } from "./session-entry";
import "./SessionRow.css";

export function SessionRow({ entry }: { entry: NavEntry }): ReactElement {
  const time = navTime(entry);
  return (
    <li className="mob-row-cell" hidden={entry.later} data-nav-entry={entry.id}>
      <span
        className="mob-row"
        data-surface={rowSurface(entry)}
        data-title={titleTone(entry)}
        data-nav-row=""
      >
        <span className="mob-row-line">
          <span className="mob-row-mark">
            <StatusDot state={navDot(entry)} className="mob-dot" data-nav-dot />
          </span>
          <span className="mob-row-ws">{entry.workspace}</span>
          <MobileBadge status={entry.status} data-nav-status />
          <span className="mob-chip" hidden={!entry.attention} data-nav-attention="">
            {entry.attention}
          </span>
          <span className="mob-row-time" hidden={!time} data-nav-time="">
            {time}
          </span>
        </span>
        <span className="mob-row-line">
          <span className="mob-row-mark mob-row-icon" data-tone={navTone(entry)} data-nav-icon="">
            {entry.role ? <RoleIcon role={entry.role} /> : <MessagesSquare />}
          </span>
          <span className="mob-row-title">{entry.title}</span>
          <RuntimeIcon kind={entry.runtime} />
        </span>
      </span>
    </li>
  );
}
