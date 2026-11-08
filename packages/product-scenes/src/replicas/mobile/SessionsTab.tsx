// The Sessions tab of the mobile app: the header, the scope switch of the open workspaces, the
// groups Needs you, Running, and Recent of the desktop sidebar, and the tab bar with the Needs you
// badge. Sources: sessions-screen.tsx, session-group-header.tsx, and session-list-model.ts in
// apps/mobile/src/features/sessions. session-groups.ts moves a row between the groups.
import { Activity, ChevronDown, CircleAlert, Clock, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { WORKSPACE } from "../../sample/workspace";
import { type NavEntry, type NavGroupId, navGroupViews } from "../shell/nav";
import { SessionsHeader } from "./MobileHeader";
import { MobileScreen } from "./MobileScreen";
import { SessionRow } from "./SessionRow";
import { TabBar } from "./TabBar";
import "./SessionsTab.css";

const GROUP_ICONS = {
  needs_you: CircleAlert,
  running: Activity,
  recent: Clock,
} satisfies Record<NavGroupId, LucideIcon>;

/**
 * The SegmentedControl of the list scope. It shows with more than one open workspace, as in the
 * sample, and the list shows every open workspace.
 */
function ScopeSwitch(): ReactElement {
  return (
    <div className="mob-scope">
      <span className="mob-scope-track">
        <span className="mob-scope-option">{WORKSPACE}</span>
        <span className="mob-scope-option" data-selected="">
          All workspaces
        </span>
      </span>
    </div>
  );
}

type SessionsTabProps = {
  entries: readonly NavEntry[];
  hidden?: boolean | undefined;
};

export function SessionsTab({ entries, hidden }: SessionsTabProps): ReactElement {
  const views = navGroupViews(entries);
  const needsYou = views.find((view) => view.group === "needs_you")?.count ?? 0;
  return (
    <MobileScreen id="sessions" background="sidebar" hidden={hidden}>
      <SessionsHeader />
      <div className="mob-list" data-list="">
        <ScopeSwitch />
        {views.map((view) => {
          const Icon = GROUP_ICONS[view.group];
          return (
            <section
              key={view.group}
              className="mob-group"
              hidden={view.hidden}
              data-nav-group={view.group}
            >
              <div className="mob-group-cell">
                <span className="mob-group-bar">
                  <Icon className="mob-group-icon" />
                  <span className="mob-group-label">{view.label}</span>
                  <b className="mob-group-count" data-nav-count={view.group}>
                    {view.count}
                  </b>
                  <ChevronDown className="mob-group-chevron" />
                </span>
              </div>
              <ul className="mob-group-list" data-nav-list={view.group}>
                {view.entries.map((entry) => (
                  <SessionRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <TabBar selected="sessions" needsYou={needsYou} />
    </MobileScreen>
  );
}
