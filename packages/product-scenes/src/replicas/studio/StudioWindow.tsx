// The session page of a task: the top bar over the full width, the workflow rail above the chat
// column, the right panel with its tabs, and an optional bottom panel. Sources:
// pages/agents/shell/agents-page-layout.tsx, agent-studio-header.tsx, and
// features/session-panels in packages/frontend/src. The sidebar is collapsed, so the session has
// room, and it groups the sessions by task. The History icon of the product is RotateCcwClock in
// Lucide 1.
import { ChevronDown, Copy, RotateCcwClock, SquareArrowOutUpRight, Zap } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { TASKS } from "../../sample/tasks";
import { taskId } from "../../sample/workspace";
import { OPEN_IN_TERMINAL } from "../../sample/worktree";
import { classes } from "../classes";
import { flag } from "../flag";
import { AppWindow } from "../shell/AppWindow";
import { Pointer } from "../shell/Pointer";
import { Thread } from "../transcript/Thread";
import { ResizeHandle } from "../ui/ResizeHandle";
import { WAITING } from "../vocabulary";
import { ChatColumn } from "./ChatColumn";
import { Composer } from "./Composer";
import type { StudioFrame } from "./model";
import { OpenInMenu } from "./OpenInMenu";
import { PanelTabs } from "./PanelTabs";
import { PanelToggles } from "./PanelToggles";
import { RepoActions } from "./RepoActions";
import { SessionHeader } from "./SessionHeader";
import { WorkflowRail } from "./WorkflowRail";
import "./StudioWindow.css";

type StudioWindowProps = {
  /** The window state of the frame that the markup holds. */
  frame: StudioFrame;
  /** The rows of the transcript. */
  children?: ReactNode;
  /** The pull request link of the top bar. */
  pr?: ReactNode;
  /** The Open In group of the top bar. The default opens the worktree in Terminal. */
  openIn?: ReactNode;
  /** The panels of the right panel. */
  panel?: ReactNode;
  /** The bottom panel. When it is present, the bottom panel toggle is pressed. */
  bottom?: ReactNode;
  /** The parts over the window, under the pointer, such as a dialog. */
  overlay?: ReactNode;
  className?: string;
};

function StudioHeader({
  frame,
  pr,
  openIn,
  bottom,
}: Pick<StudioWindowProps, "frame" | "pr" | "openIn"> & { bottom: boolean }): ReactElement {
  const title = (
    <>
      <span className="sh-name">
        <span>{TASKS.k3x9.title}</span>
        <SquareArrowOutUpRight className="i12" />
      </span>
      <span className="sh-id">
        <code>{taskId("k3x9")}</code>
        <span>
          <Copy className="i12" />
        </span>
      </span>
    </>
  );
  return (
    <SessionHeader title={title}>
      {pr}
      <RepoActions />
      <span className="sh-icon sh-hide-narrow">
        <RotateCcwClock />
      </span>
      <span className="sh-split" data-disabled={flag(frame.actionDisabled)} data-split="">
        <span className="sh-split-main" data-quick-action="">
          <Zap />
          <span data-action="">{frame.action}</span>
        </span>
        <span className="sh-split-menu">
          <ChevronDown />
        </span>
      </span>
      {openIn ?? <OpenInMenu tool={OPEN_IN_TERMINAL} appIcon />}
      <PanelToggles bottom={bottom} />
    </SessionHeader>
  );
}

export function StudioWindow({
  frame,
  children,
  pr,
  openIn,
  panel,
  bottom,
  overlay,
  className,
}: StudioWindowProps): ReactElement {
  return (
    <AppWindow
      chrome={{ sidebar: "collapsed", nav: { scope: "current", entries: frame.nav } }}
      className={classes("studio", className)}
      data-studio
      data-runtime={frame.session.runtime}
      data-focus={frame.focus}
      data-panel-size={frame.panelSize}
      overlay={
        <>
          {overlay}
          <Pointer />
        </>
      }
    >
      <StudioHeader frame={frame} pr={pr} openIn={openIn} bottom={bottom !== undefined} />
      <div className="st-area">
        <div className="st-body">
          <div className="st-main">
            <WorkflowRail tones={frame.tones} selected={frame.selected} />
            <ChatColumn>
              <Thread>{children}</Thread>
              <div className="st-stack" data-stack="" />
              <Composer session={frame.session} commentCount>
                <span className="when-waiting" data-waiting="">
                  {WAITING.question}
                </span>
              </Composer>
            </ChatColumn>
          </div>
          <ResizeHandle orientation="vertical" className="st-handle" />
          <div className="st-panel">
            <PanelTabs frame={frame} />
            <div className="st-panel-body" data-panel-body="" data-active-panel={frame.panel}>
              {panel}
            </div>
          </div>
        </div>
        {bottom}
      </div>
    </AppWindow>
  );
}
