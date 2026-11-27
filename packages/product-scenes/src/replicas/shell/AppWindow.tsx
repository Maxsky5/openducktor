// The window of the desktop app: the macOS window controls, the workspace rail, the sidebar, and
// the page in the children. The desktop app draws the window controls over the workspace rail. A
// window without a sidebar shows no workspace rail either, as a cropped window does. A tablet stage
// drops the full sidebar, unless the window pins it. A phone stage shows one pane of a window with
// `pane`: the sidebar or the page. A scene switches `data-pane`.
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { classes } from "../classes";
import { flag } from "../flag";
import { type KeyLabels, MAC_KEYS } from "../keys";
import { Replica } from "../Replica";
import type { NavData } from "./nav";
import { Rail, type RailProcesses } from "./Rail";
import { Sidebar, type SidebarPage } from "./Sidebar";
import { SidebarCollapsed } from "./SidebarCollapsed";
import "./AppWindow.css";

/**
 * The sidebar of the window and its session list, which also gives the badges of the rail, and
 * the current page when the sidebar has a link to it.
 */
type Chrome =
  | {
      sidebar: "full";
      nav: NavData;
      version: string | null;
      /** The sidebar stays on a tablet stage, as a scene that starts in the sidebar needs. */
      pinned?: boolean;
      /** The Processes button of the rail. Without it, no command runs. */
      processes?: RailProcesses;
      page?: SidebarPage | undefined;
    }
  | { sidebar: "collapsed"; nav: NavData; page?: SidebarPage | undefined }
  | { sidebar: "none" };

type AppWindowProps = ComponentProps<"div"> & {
  chrome: Chrome;
  /** The window sits in the root of another replica, so it is not a replica root. */
  nested?: boolean;
  /** The keys of the sidebar. The default is the macOS keys. */
  keys?: KeyLabels;
  /** The parts over the window, such as a dialog or the pointer. */
  overlay?: ReactNode;
  /** The pane that a phone stage shows. Without it, a phone stage shows the sidebar and the page. */
  pane?: "sidebar" | "main";
};

function Sidebars({ chrome, keys }: { chrome: Chrome; keys: KeyLabels }): ReactNode {
  switch (chrome.sidebar) {
    case "full":
      return (
        <>
          <Rail
            entries={chrome.nav.entries}
            hintKeys={chrome.nav.hints ? keys : undefined}
            processes={chrome.processes}
          />
          <Sidebar nav={chrome.nav} keys={keys} version={chrome.version} page={chrome.page} />
        </>
      );
    case "collapsed":
      return (
        <>
          <Rail entries={chrome.nav.entries} />
          <SidebarCollapsed nav={chrome.nav} page={chrome.page} />
        </>
      );
    case "none":
      return null;
  }
}

export function AppWindow({
  chrome,
  nested = false,
  keys = MAC_KEYS,
  overlay,
  pane,
  className,
  children,
  ...attributes
}: AppWindowProps): ReactElement {
  const Root = nested ? "div" : Replica;
  return (
    <Root
      className={classes("app-window", className)}
      data-sidebar={chrome.sidebar}
      data-sidebar-pinned={flag(chrome.sidebar === "full" && chrome.pinned)}
      data-pane={pane}
      {...attributes}
    >
      <span className="traffic" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div className="app-body">
        <Sidebars chrome={chrome} keys={keys} />
        <div className="app-main">{children}</div>
      </div>
      {overlay}
    </Root>
  );
}
