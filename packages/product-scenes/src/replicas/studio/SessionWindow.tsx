// The window of a workspace session in the scenes of the documentation: the open sidebar next to
// the page, a dialog over the window, and the pointer. The sidebar stays on a tablet stage,
// because the scenes start in it or change it. A phone stage shows one pane, the sidebar or the
// page, and a scene switches `data-pane`. A scene sets the height of its window with
// --window-height in design pixels.
import type { ReactElement, ReactNode } from "react";
import type { Session } from "../../sample/sessions";
import { classes } from "../classes";
import type { KeyLabels } from "../keys";
import { AppWindow } from "../shell/AppWindow";
import type { NavData } from "../shell/nav";
import { Pointer } from "../shell/Pointer";
import "./SessionWindow.css";

type SessionWindowProps = {
  nav: NavData;
  /** The sidebar shows the Kanban entry. */
  kanban?: boolean;
  keys: KeyLabels;
  session: Session;
  /** The pane that a phone stage shows in the static frame. */
  pane: "sidebar" | "main";
  /** The dialog over the window. */
  dialog: ReactNode;
  className?: string;
  /** The pages of the window. */
  children: ReactNode;
};

export function SessionWindow({
  nav,
  kanban = false,
  keys,
  session,
  pane,
  dialog,
  className,
  children,
}: SessionWindowProps): ReactElement {
  return (
    <AppWindow
      chrome={{ sidebar: "full", nav, kanban, version: null, pinned: true }}
      keys={keys}
      className={classes("session-window", className)}
      data-runtime={session.runtime}
      pane={pane}
      overlay={
        <>
          {dialog}
          <Pointer />
        </>
      }
    >
      {children}
    </AppWindow>
  );
}
