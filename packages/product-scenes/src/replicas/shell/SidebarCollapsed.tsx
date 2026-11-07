// The collapsed sidebar of workspace-sidebar.tsx: the show button in the title bar, the command
// palette, the Kanban link, the New task button, the scope toggle, one icon for each session in
// session-navigation-rail.tsx, and Diagnostics and Settings. The icons sit under the label and
// the count of their group.
import {
  Columns3,
  LayoutGrid,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { ReactElement } from "react";
import { type NavData, navGroupViews } from "./nav";
import { NavIcon } from "./NavIcon";
import "./NavGroups.css";
import "./SidebarCollapsed.css";

type SidebarCollapsedProps = { nav: NavData; kanban?: boolean };

export function SidebarCollapsed({ nav, kanban = false }: SidebarCollapsedProps): ReactElement {
  const groups = navGroupViews(nav.entries);
  return (
    <div className="sb-collapsed">
      <div className="sbc-title">
        <span className="sbc-button">
          <PanelLeftOpen />
        </span>
      </div>
      <div className="sbc-tools">
        <span className="sbc-button large">
          <Search />
        </span>
        <span className="sbc-button large" aria-current={kanban ? "true" : undefined}>
          <Columns3 />
        </span>
        <span className="sbc-button large primary">
          <Plus />
        </span>
      </div>
      <div className="sbc-scope">
        <span className="sbc-button" aria-pressed={nav.scope === "all" ? "true" : "false"}>
          <LayoutGrid />
        </span>
      </div>
      <div className="sbc-sessions">
        {groups.map(({ group, label, entries, count, hidden }) => (
          <div className="sbc-group" hidden={hidden} data-nav-group={group} key={group}>
            <p className="sbc-label">
              <span>{label}</span>
              <b className="nav-count" data-nav-count={group}>
                {count}
              </b>
            </p>
            <ul className="sbc-list" data-nav-list={group}>
              {entries.map((entry) => (
                <NavIcon entry={entry} key={entry.id} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="sbc-footer">
        <span className="sbc-button large health">
          <ShieldCheck />
        </span>
        <span className="sbc-button large">
          <Settings />
        </span>
      </div>
    </div>
  );
}
