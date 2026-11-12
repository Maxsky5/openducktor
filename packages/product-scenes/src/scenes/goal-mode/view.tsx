// Goal mode: the session page of the sample task, from the Planner session in Ready for dev to a
// Builder session that works toward a goal on Codex. The start dialog of Start Implementation is a
// template. Its Goal mode switch shows the default goal, and Generate goal replaces it. The goal row
// above the composer shows the goal, and Codex starts each next turn by itself until the goal is met.
// Sources: session-start-goal-field.tsx and agent-chat-goal-row.tsx in
// packages/frontend/src/components/features/agents, and agent-session-goal-row.ts in
// packages/frontend-core. The markup holds the last frame.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { ArtifactPanel } from "../../replicas/studio/ArtifactPanel";
import { GitPanel } from "../../replicas/studio/GitPanel";
import { GoalRow } from "../../replicas/studio/GoalRow";
import { StartDialog } from "../../replicas/studio/StartDialog";
import { StartupProgress } from "../../replicas/studio/StartupProgress";
import { PlanDocument } from "../../replicas/studio/StoryDocuments";
import { StudioWindow } from "../../replicas/studio/StudioWindow";
import { Transcript } from "../../replicas/transcript/Transcript";
import { ARTIFACTS, FRAMES } from "../../sample/studio";
import { storySessions } from "../../sample/transcripts";
import {
  DEFAULT_GOAL,
  GENERATED_GOAL,
  GOAL_FILES,
  GOAL_SESSION,
  GOAL_TRANSCRIPT,
  type GoalModeTemplate,
  ORIGIN,
  STEPS,
} from "./sample";

export function GoalModeView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="goal-mode"
      alt={`The session page of the task Open search with a keyboard shortcut, in Ready for dev. The Planner session is open, and its plan shows in the Artifacts tab. The visitor clicks Start Implementation. The dialog Start Builder session opens with the target branch origin/main, the model GPT-6-Astra on Codex, and two switches: Goal mode and Customize first message. The visitor turns Goal mode on. The Goal field opens with the default goal: implement the task as its description, spec, and plan define, until each requirement works, every required check passes, and the build is reported as completed. Customize first message goes away. The visitor clicks Generate goal. The button shows Generating goal, and a sharper goal replaces the text: Cmd+K and Ctrl+K open the search dialog, the shortcut does nothing with Shift, in a text field, in the note editor, or while another dialog is open, and the search tests pass. The visitor clicks Start session. The dialog shows the startup steps, then the Builder session opens. A goal row shows above the composer: Goal, Active, and the first line of the goal, with Pause goal and Clear goal. The Builder works without a first message. It reads the task, writes the hook and the app shell, and ends its turn. Codex starts the next turn by itself: the Builder writes the tests and runs them. The visitor clicks the goal row, which opens to show the whole goal, then closes it. In a third turn, the Builder runs lint and the type check, commits the change, and reports the build as completed. The goal row shows Complete in green, with only Clear goal. The task moves to AI Review.`}
      stock={
        <Stock name={"builder-dialog" satisfies GoalModeTemplate}>
          <StartDialog
            role="Builder"
            session={GOAL_SESSION}
            target="origin/main"
            goal
            goalText={DEFAULT_GOAL}
            progress={<StartupProgress origin={ORIGIN} steps={STEPS} />}
          />
        </Stock>
      }
    >
      <StudioWindow
        frame={FRAMES.build}
        className="gm-window"
        panels={{
          document: (
            <ArtifactPanel labels={ARTIFACTS.plan}>
              <PlanDocument />
            </ArtifactPanel>
          ),
          diffs: <GitPanel files={GOAL_FILES} ahead={1} />,
        }}
        goal={<GoalRow objective={GENERATED_GOAL} status="complete" pausable />}
      >
        <Transcript
          sessions={[...storySessions([{ id: "planner", turns: 1 }]), GOAL_TRANSCRIPT]}
          shown={GOAL_TRANSCRIPT.id}
        />
      </StudioWindow>
    </SceneFrame>
  );
}
