// The session page of a task session or a chat, from session-page-header.tsx,
// agents-page-layout.tsx, and features/session-panels in packages/frontend/src. `SessionPane` is
// the page: the top bar, the workflow rail of a task, the chat column with the docked requests and
// the composer, the right panel, and the bottom panel. `SessionPage` is the page of the sample task in its own
// window, cropped to the top bar, the chat column, and the right panel, for the short scenes of
// the documentation. A phone stage shows only its right panel, as a narrow window shows one panel
// at a time.
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { Session } from "../../sample/sessions";
import { classes } from "../classes";
import { Replica } from "../Replica";
import { Pointer } from "../shell/Pointer";
import { Thread } from "../transcript/Thread";
import { ResizeHandle } from "../ui/ResizeHandle";
import { Tooltip } from "../ui/Tooltip";
import { ChatColumn } from "./ChatColumn";
import { PanelToggles } from "./PanelToggles";
import { SessionHeader, TaskTitle } from "./SessionHeader";
import "../shell/AppWindow.css";
import "./SessionPage.css";

type SessionPaneProps = Omit<ComponentProps<"div">, "children"> & {
  /** The top bar. */
  header: ReactNode;
  /** The workflow rail of a task session, above the chat column. */
  rail?: ReactNode;
  /** The rows of the chat. */
  chat: ReactNode;
  /** The requests that dock above the composer. A scene adds them to the empty stack. */
  stack?: ReactNode;
  composer: ReactNode;
  /**
   * The tab strip and the content of the right panel. The panel and its separator have the scene
   * hooks `data-right-panel` and `data-right-handle`.
   */
  panel?: ReactNode;
  /** The bottom panel under the chat column and the right panel, with its separator. */
  bottom?: ReactNode;
};

export function SessionPane({
  header,
  rail,
  chat,
  stack,
  composer,
  panel,
  bottom,
  className,
  ...attributes
}: SessionPaneProps): ReactElement {
  return (
    <div className={classes("page-pane", className)} {...attributes}>
      {header}
      {rail}
      <div className="tpage-main">
        <ChatColumn className="tpage-chat">
          <Thread>{chat}</Thread>
          {stack !== undefined && (
            <div className="st-stack" data-stack="">
              {stack}
            </div>
          )}
          {composer}
        </ChatColumn>
        {panel !== undefined && (
          <>
            <ResizeHandle orientation="vertical" data-right-handle="" />
            <div className="tpage-right" data-right-panel="">
              {panel}
            </div>
          </>
        )}
      </div>
      {bottom}
    </div>
  );
}

type SessionPageProps = {
  session: Session;
  className?: string;
  /** The actions of the top bar before the panel toggles, such as the pull request. */
  actions?: ReactNode;
  /** The rows of the chat. */
  chat: ReactNode;
  composer: ReactNode;
  /** The tab strip and the content of the right panel. */
  panel: ReactNode;
  /** The parts over the window, under the pointer, such as a dialog. */
  overlay?: ReactNode;
};

export function SessionPage({
  session,
  className,
  actions,
  chat,
  composer,
  panel,
  overlay,
}: SessionPageProps): ReactElement {
  return (
    <Replica className={classes("app-window", "tpage", className)} data-runtime={session.runtime}>
      <SessionPane
        header={
          <SessionHeader title={<TaskTitle task="k3x9" />}>
            {actions}
            <PanelToggles />
          </SessionHeader>
        }
        chat={chat}
        composer={composer}
        panel={panel}
      />
      {overlay}
      <Tooltip />
      <Pointer />
    </Replica>
  );
}
