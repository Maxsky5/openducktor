// The open sidebar of workspace-sidebar.tsx in the macOS window: the hide button in the title bar,
// the brand with the command palette button, the Kanban link, the New task split button, the scope
// and grouping controls, the session list, and the footer with Settings and Diagnostics.
import {
  Activity,
  ChevronDown,
  CircleAlert,
  Clock,
  Columns3,
  ListTree,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";
import { WORKSPACE } from "../../sample/workspace";
import { flag } from "../flag";
import type { KeyLabels } from "../keys";
import { Kbd } from "../ui/Kbd";
import { type NavData, type NavGroupId, navGroupViews } from "./nav";
import { NavRow } from "./NavRow";
import "./NavGroups.css";
import "./Sidebar.css";

type SidebarProps = {
  nav: NavData;
  /** The Kanban link is the only page link. It is current on the Kanban page. */
  kanban?: boolean;
  /** The keys of the command palette button. */
  keys: KeyLabels;
  /** The version of the app under its name, such as the latest release. Null shows no version. */
  version: string | null;
};

const ICONS = {
  needs_you: CircleAlert,
  running: Activity,
  recent: Clock,
} as const satisfies Record<NavGroupId, LucideIcon>;

export function Sidebar({ nav, kanban = false, keys, version }: SidebarProps): ReactElement {
  const groups = navGroupViews(nav.entries);
  const collapsed = nav.collapsed ?? [];
  const omitted = nav.omitted ?? [];
  return (
    <div className="sidebar">
      <div className="sb-head">
        <div className="sb-heading">
          <span className="sb-hide">
            <PanelLeftClose />
          </span>
          <div className="sb-brand">
            <span className="mark" />
            <div>
              <strong>OpenDucktor</strong>
              {version && <small>{version}</small>}
            </div>
            <span className="sb-search">
              <Search className="i14" />
              <Kbd keys={[keys.modifier, "K"]} />
            </span>
          </div>
        </div>
        <div className="sb-actions">
          <span className="sb-kanban" aria-current={kanban ? "true" : undefined} data-kanban="">
            <Columns3 />
            Kanban
          </span>
          <span className="sb-create">
            <span className="sb-create-main">
              <Plus />
              New task
            </span>
            <span className="sb-create-menu" data-create-trigger="">
              <ChevronDown />
            </span>
          </span>
        </div>
      </div>
      <div className="sb-controls">
        <span className="sb-scope">
          <span data-checked={flag(nav.scope === "current")}>{WORKSPACE}</span>
          <span data-checked={flag(nav.scope === "all")}>All workspaces</span>
        </span>
        <span className="sb-grouping">
          <ListTree />
        </span>
      </div>
      <div className="sb-sessions">
        {groups.map(({ group, label, entries, count, hidden }) => {
          const Icon = ICONS[group];
          return (
            <div
              className="sb-group"
              hidden={hidden}
              data-nav-group={group}
              data-collapsed={flag(collapsed.includes(group))}
              data-omitted={flag(omitted.includes(group))}
              key={group}
            >
              <span className="sb-group-head">
                <Icon className="sb-group-icon" />
                <span>{label}</span>
                <b className="nav-count" data-nav-count={group}>
                  {count}
                </b>
                <ChevronDown className="sb-group-chevron" />
              </span>
              <ul className="sb-list" hidden={collapsed.includes(group)} data-nav-list={group}>
                {entries.map((entry) => (
                  <NavRow entry={entry} key={entry.id} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="sb-footer">
        <span className="sb-settings">
          <Settings />
          Settings
        </span>
        <span className="sb-diagnostics">
          <ShieldCheck />
        </span>
      </div>
    </div>
  );
}
