// The session page of the Builder after its turn: the Builder transcript, the Diffs tab, the
// repository actions in the top bar, and the bottom panel with one terminal for each action that
// runs. The markup holds the last frame.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { BottomPanel } from "../../replicas/studio/BottomPanel";
import { GitPanel } from "../../replicas/studio/GitPanel";
import { OpenInMenu } from "../../replicas/studio/OpenInMenu";
import { StudioWindow } from "../../replicas/studio/StudioWindow";
import { Transcript } from "../../replicas/transcript/Transcript";
import { BUILD_FILES } from "../../sample/studio";
import { storySessions } from "../../sample/transcripts";
import { OPEN_IN_CHOICE, OPEN_IN_DEFAULT } from "../../sample/worktree";
import { FRAME } from "./sample";
import "./view.css";

export function ActionsView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="actions"
      alt={`The session page of a task after its Builder session, with the four changed files of the task branch in the Diffs tab. The visitor runs Web, the default repository action of the top bar. The bottom panel opens with a Web terminal that starts the dev server in the task worktree. Then the visitor runs API from the actions menu, and a second terminal tab streams its log. At the end, the visitor opens the worktree in ${OPEN_IN_CHOICE}.`}
    >
      <StudioWindow
        className="actions-studio"
        frame={FRAME}
        panels={{ diffs: <GitPanel files={BUILD_FILES} ahead={1} /> }}
        openIn={<OpenInMenu tool={OPEN_IN_DEFAULT} appIcon menu />}
        bottom={<BottomPanel terminals={["web", "api"]} active="api" />}
      >
        <Transcript sessions={storySessions([{ id: "build", turns: 1 }])} shown="build" />
      </StudioWindow>
    </SceneFrame>
  );
}
