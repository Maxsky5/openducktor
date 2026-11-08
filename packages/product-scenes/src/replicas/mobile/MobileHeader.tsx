// The navigation bars of the mobile app on Android. A tab screen shows its title on the left and its
// plain header actions on the right, as the Sessions tab of sessions-screen.tsx. A session shows
// the back control, the task title with its open icon, and the outline buttons of the task
// sessions, the quick actions, and the session menu, as session-header.tsx and
// session-header-title.tsx in apps/mobile/src/features/session/header.
import {
  Archive,
  ArrowLeft,
  Ellipsis,
  History,
  ListTree,
  Search,
  SquareArrowOutUpRight,
  Zap,
} from "lucide-react";
import type { ReactElement } from "react";
import "./MobileHeader.css";

/** The header of the Sessions tab: the grouping switch, Archived Sessions, and the search. */
export function SessionsHeader(): ReactElement {
  return (
    <header className="mob-header" data-kind="tab">
      <span className="mob-header-title">Sessions</span>
      <span className="mob-header-icon">
        <ListTree />
      </span>
      <span className="mob-header-icon">
        <Archive />
      </span>
      <span className="mob-header-icon">
        <Search />
      </span>
    </header>
  );
}

/** The header of a task session. The title opens the task details, so it shows the open icon. */
export function SessionHeader({ title }: { title: string }): ReactElement {
  return (
    <header className="mob-header" data-kind="session">
      <span className="mob-header-back" data-back="">
        <ArrowLeft />
      </span>
      <span className="mob-header-center">
        <span className="mob-header-task">
          <span className="mob-header-task-text">{title}</span>
          <SquareArrowOutUpRight />
        </span>
      </span>
      <span className="mob-header-actions">
        <span className="mob-outline-icon">
          <History />
        </span>
        <span className="mob-outline-icon" data-quick-actions="">
          <Zap />
        </span>
        <span className="mob-outline-icon" data-session-menu="">
          <Ellipsis />
        </span>
      </span>
    </header>
  );
}
