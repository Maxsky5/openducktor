// The Processes view: the commands that run in the checkouts of the open workspaces, with their
// ports and Stop, from any page. The window starts on the session page of the empty notebook task
// with the open sidebar, while its Builder works, and ends on the Kanban board. Sources:
// processes-surfaces.tsx, processes-panel.tsx, process-group-section.tsx, process-command-row.tsx,
// process-stop-popover.tsx, and task-server-links.tsx in
// packages/frontend/src/components/features/processes, and workspace-rail.tsx and
// floating-window.tsx in packages/frontend/src/components. The markup holds the last frame: the
// watcher is stopped, and the floating window at its minimum size shows the dev server over the
// board. The session page and the flyout are hidden. The flyout markup holds both checkouts, as it
// opens.
import { Zap } from "lucide-react";
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import { PROCESSES_LABELS } from "../../replicas/processes/model";
import { PortsButton } from "../../replicas/processes/PortsButton";
import { ProcessesFlyout, ProcessesWindow } from "../../replicas/processes/ProcessesSurfaces";
import { AppWindow } from "../../replicas/shell/AppWindow";
import { Pointer } from "../../replicas/shell/Pointer";
import { Composer } from "../../replicas/studio/Composer";
import { PanelToggles } from "../../replicas/studio/PanelToggles";
import { SessionHeader, SplitAction, TaskTitle } from "../../replicas/studio/SessionHeader";
import { SessionPane } from "../../replicas/studio/SessionPage";
import { WorkflowRail } from "../../replicas/studio/WorkflowRail";
import { AgentText } from "../../replicas/transcript/AgentText";
import { ToolRun } from "../../replicas/transcript/ToolRun";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { Paragraph } from "../../replicas/ui/InlineCode";
import {
  ACTION,
  AFTER_SERVER,
  BOARD,
  BEFORE_SERVER,
  BEFORE_STOP,
  EDIT_CALLS,
  INTRO,
  KICKOFF_MESSAGE,
  NAV,
  ON_BOARD,
  PLAN,
  READ_CALLS,
  SERVER,
  SERVER_CALL,
  SESSION,
  TASK,
  TASK_CHECKOUT,
  TONES,
  WATCHER,
} from "./sample";
import "./view.css";

export function ProcessesView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="processes"
      alt={`The session page of the task ${TASK_CHECKOUT.title}, with the open sidebar. The Builder starts the dev server with ${SERVER.command}. The ${PROCESSES_LABELS.title} button at the bottom of the workspace rail, ${PROCESSES_LABELS.railTip}, shows the count 2, and the top bar of the session shows 1 port. The developer selects Processes, and the list opens beside the rail with the live counts 2 commands and 1 port. The worktree of the task comes first, with the This task badge and ${SERVER.command} on port ${SERVER.ports.join(", ")}. The repository checkout follows with ${WATCHER.command} in ${WATCHER.directory}. The developer selects Stop on ${WATCHER.command}, and a confirmation beside the button names the folder and PID ${WATCHER.pid}. The developer selects Stop. The command stops, its checkout leaves the list, and the counts show 1 command and 1 port. Then the developer selects ${PROCESSES_LABELS.detach}. The list becomes a floating window where the flyout was. The developer drags its corner to make it smaller. Then the developer selects Kanban in the sidebar. The board shows, and the floating window stays on top of it. The checkout loses the This task badge, because the board shows no task. The developer moves the window by its title bar to the empty lower right of the board.`}
    >
      <AppWindow
        chrome={{
          sidebar: "full",
          nav: { scope: "current", entries: NAV },
          page: "kanban",
          version: null,
          pinned: true,
          processes: { count: 1, open: true },
        }}
        keys={props.keys}
        className="pr-window"
        pane="main"
        overlay={
          <>
            <ProcessesWindow groups={ON_BOARD} />
            <ProcessesFlyout groups={BEFORE_STOP} stopping={WATCHER} />
            <Pointer />
          </>
        }
      >
        <SessionPane
          data-page="session"
          data-runtime={SESSION.runtime}
          hidden
          header={
            <SessionHeader title={<TaskTitle task={TASK} />}>
              <PortsButton count={SERVER.ports.length} data-task-ports="" />
              <SplitAction icon={Zap} label={ACTION} disabled quickAction />
              <PanelToggles right={false} />
            </SessionHeader>
          }
          rail={<WorkflowRail tones={TONES} selected="build" />}
          chat={
            <>
              <UserMessage time={KICKOFF_MESSAGE.time} row="kickoff">
                {KICKOFF_MESSAGE.text}
              </UserMessage>
              <AgentText row="intro">
                <Paragraph text={INTRO} />
              </AgentText>
              <ToolRun calls={READ_CALLS} folded />
              <AgentText row="plan">
                <Paragraph text={PLAN} />
              </AgentText>
              <ToolRun calls={EDIT_CALLS} folded />
              <AgentText row="before">
                <Paragraph text={BEFORE_SERVER} />
              </AgentText>
              <ToolRun calls={[SERVER_CALL]} folded />
              <AgentText row="after">
                <Paragraph text={AFTER_SERVER} />
              </AgentText>
            </>
          }
          composer={<Composer session={SESSION} keys={props.keys} activity="working" />}
        />
        <div className="page-pane" data-page="board">
          <BoardHead />
          <Board board={BOARD} />
        </div>
      </AppWindow>
    </SceneFrame>
  );
}
