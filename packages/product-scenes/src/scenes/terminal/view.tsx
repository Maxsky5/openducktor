// The session page of a task, cropped to the top bar, the chat column, and the side panels. The
// visitor opens a terminal in the task worktree, types a command, then runs the default repository
// action, which opens a second terminal. Last, the visitor drags the first terminal to the right
// panel. Sources: session-view-controls.tsx and repository-actions/repo-actions-split-button.tsx
// in packages/frontend/src/components/features, features/session-panels and features/terminals
// in packages/frontend/src, and docs/interactive-terminal-architecture.md. The markup holds the
// last frame: the first terminal in the right panel, and the Test terminal in the bottom panel
// after its tests pass. A phone stage shows one panel, so it hides the right panel and has no drag.
import { RotateCw, SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Replica } from "../../replicas/Replica";
import { KeyHud } from "../../replicas/shell/KeyHud";
import { Pointer } from "../../replicas/shell/Pointer";
import { BottomPanelFrame } from "../../replicas/studio/BottomPanel";
import { Composer } from "../../replicas/studio/Composer";
import { GitPanel } from "../../replicas/studio/GitPanel";
import { PanelTab } from "../../replicas/studio/PanelTab";
import { PanelTabs } from "../../replicas/studio/PanelTabs";
import { PanelToggles } from "../../replicas/studio/PanelToggles";
import { RepoActions } from "../../replicas/studio/RepoActions";
import { SessionHeader, TaskTitle } from "../../replicas/studio/SessionHeader";
import { SessionPane } from "../../replicas/studio/SessionPage";
import { Transcript } from "../../replicas/transcript/Transcript";
import { Tooltip } from "../../replicas/ui/Tooltip";
import { BUILD_FILES, BUILDER_SESSION } from "../../sample/studio";
import { SHELL_LABEL, TERMINAL_ACTIONS } from "../../sample/terminal";
import { storySessions } from "../../sample/transcripts";
import { GIT_STATUS_OUTPUT, TEST_OUTPUT, TYPED_COMMAND } from "./sample";
import { TerminalScreen } from "./TerminalScreen";
import "./view.css";

const TEST = TERMINAL_ACTIONS.test.name;

/**
 * The right panel: the tool tabs of the task, then the first terminal after its drop. The content
 * keeps its open width at the right edge, so a panel that opens shows it from the right.
 */
function RightPanel(): ReactElement {
  return (
    <div className="tv-right-content" data-right-content="">
      <PanelTabs fadeStart showEnd>
        <PanelTab id="shell" label={SHELL_LABEL} active>
          <SquareTerminal />
        </PanelTab>
      </PanelTabs>
      <div className="tv-right-body" data-right-body="">
        <div className="tv-view" hidden data-tab-view="diffs">
          <GitPanel files={BUILD_FILES} ahead={1} />
        </div>
        <TerminalScreen id="shell" lines={GIT_STATUS_OUTPUT} typed={TYPED_COMMAND} />
      </div>
    </div>
  );
}

/** The bottom panel with the Test terminal, which shows Restart while a command runs. */
function BottomPanel(): ReactElement {
  return (
    <BottomPanelFrame
      className="tv-panel"
      tabs={
        <PanelTab id="test" label={TEST} active>
          <SquareTerminal />
        </PanelTab>
      }
      end={
        <span className="tv-restart" hidden data-restart="">
          <RotateCw />
        </span>
      }
    >
      <TerminalScreen id="test" lines={TEST_OUTPUT} />
    </BottomPanelFrame>
  );
}

export function TerminalView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="terminal"
      alt={`The session page of a task after its Builder session. The developer selects Show bottom panel at the top right. The bottom panel opens with a new terminal in the task worktree. The developer types ${TYPED_COMMAND} and presses Enter, and the terminal shows that the working tree is clean. Then the developer selects Run ${TEST}, the default repository action in the top bar. A second terminal tab named ${TEST} opens and runs bun install, then bun test. All 4 tests pass. The developer selects Show right panel, which opens the Diffs tab next to the chat. Then the developer drags the first terminal tab from the bottom panel to the tabs of the right panel. The right panel shows that terminal with its output, and the bottom panel keeps the ${TEST} terminal.`}
    >
      <Replica className="app-window tv-window" data-runtime={BUILDER_SESSION.runtime}>
        <SessionPane
          header={
            <SessionHeader title={<TaskTitle task="k3x9" />}>
              <RepoActions actions={TERMINAL_ACTIONS} />
              <PanelToggles bottom />
            </SessionHeader>
          }
          chat={<Transcript sessions={storySessions([{ id: "build", turns: 1 }])} shown="build" />}
          composer={<Composer session={BUILDER_SESSION} />}
          panel={<RightPanel />}
          bottom={<BottomPanel />}
        />
        {/* The drag preview of session-panels-root.tsx, which follows the pointer. */}
        <span className="tv-drag" hidden data-drag="">
          <SquareTerminal />
          <span>{SHELL_LABEL}</span>
        </span>
        <Tooltip />
        <Pointer />
      </Replica>
      <KeyHud />
    </SceneFrame>
  );
}
