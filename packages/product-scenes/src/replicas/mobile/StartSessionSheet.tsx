// The session start sheet of the mobile app, as session-start-sheet.tsx and session-start-form.tsx
// in apps/mobile/src/features/workflow/start-session. The title names the role. A launch with one
// start mode, such as Start Builder, names that mode in the lead and shows no Session mode control.
// A launch with more than one, such as the pull request launch, asks how to start: the Session mode
// control, then the Existing session that a reuse or a fork starts from. Then the target branch,
// the runtime and model, the effort and speed tracks, the Goal mode switch of a launch with a goal,
// and the switch that customizes the first message. A reuse keeps the runtime, the model, and the
// effort of its source session, so these fields are read-only. The footer holds Run in background
// above Cancel and Start session. While a start runs, the sheet has `data-busy`: the form shows the
// progress of the start, Run in background becomes Continue in background, which stays enabled,
// and the model hint of a reuse says that the start runs. A start that sets up a worktree shows
// its startup progress in the place of the form. The title and the lead follow
// use-session-start-modal-coordinator.ts in packages/frontend-core.
import { GitBranch, Layers, MessageSquare, Play, ZapOff } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { Session } from "../../sample/sessions";
import { modelName, RUNTIME_LABELS } from "../../sample/models";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import type { Role } from "../vocabulary";
import { FormField, SegmentedControl, SelectTrigger, SwitchCard } from "./FormRows";
import { StepSlider } from "./StepSlider";
import { SheetButton, WorkflowSheet } from "./WorkflowSheet";
import "./StartSessionSheet.css";

/** The labels of the runtimes, as the runtime descriptors name them. */
/** The fixed text of the start sheet. */
export const START_SHEET_TEXT = {
  freshLead: "Start a new session.",
  chooseLead: "Choose how to start this session.",
  sessionMode: "Session mode",
  existingSession: "Existing session",
  targetBranch: "Target branch",
  targetBranchHint: "Use this branch as the merge target.",
  reuseModelHint: "Reuse mode keeps the source session runtime and model.",
  startingModelHint: "Session start is in progress.",
  speedHint: "Higher levels may cost more. Applies to the next turn.",
  goalMode: "Goal mode",
  goalModeDescription:
    "The agent gets a goal instead of a first message, and works until the goal is met.",
  customize: "Customize first message",
  customizeDescription: "Replace the first message that this action sends to the agent.",
  runInBackground: "Run in background",
  continueInBackground: "Continue in background",
  confirm: "Start session",
} as const;

/** A way to start a session: a new session, the source session, or a copy of it. */
export type StartMode = "fresh" | "reuse" | "fork";

/** The labels of the start modes, as sessionStartModeButtonLabel names them. */
export const START_MODE_LABELS = {
  fresh: "Start fresh",
  reuse: "Reuse existing",
  fork: "Fork existing",
} as const satisfies Record<StartMode, string>;

/** The start modes of a launch with more than one, in the order of the control. */
export type StartModes = {
  modes: readonly StartMode[];
  selected: StartMode;
  /** The session that a reuse or a fork starts from, as its option names it, such as Builder #1. */
  source: string;
};

type StartSessionSheetProps = {
  role: Role;
  session: Session;
  /** The target branch, as the branch picker names it. */
  target: string;
  /** The effort levels of the model. */
  efforts: readonly string[];
  /** The start modes of a launch with more than one. A launch with one start mode has none. */
  startModes?: StartModes;
  /** The launch offers Goal mode, such as Start Implementation. */
  goal?: boolean;
  /** The startup progress that takes the place of the form while a start sets up a worktree. */
  progress?: ReactNode;
  hidden?: boolean | undefined;
};

export function StartSessionSheet({
  role,
  session,
  target,
  efforts,
  startModes,
  goal = false,
  progress,
  hidden,
}: StartSessionSheetProps): ReactElement {
  const model = modelName(session);
  const reuse = startModes?.selected === "reuse";
  return (
    <WorkflowSheet
      id="start"
      title={`Start ${role} session`}
      intro={
        <p className="mob-fsheet-lead">
          {startModes ? START_SHEET_TEXT.chooseLead : START_SHEET_TEXT.freshLead}
        </p>
      }
      progress={progress}
      hidden={hidden}
      secondary={
        <span className="mob-start-background">
          <Layers />
          <span data-when="idle">{START_SHEET_TEXT.runInBackground}</span>
          <span data-when="busy">{START_SHEET_TEXT.continueInBackground}</span>
        </span>
      }
      primary={
        <SheetButton
          variant="filled"
          Icon={Play}
          label={START_SHEET_TEXT.confirm}
          data-start-session=""
        />
      }
    >
      {startModes && (
        <>
          <FormField label={START_SHEET_TEXT.sessionMode}>
            <SegmentedControl
              options={startModes.modes.map((mode) => ({
                value: mode,
                label: START_MODE_LABELS[mode],
              }))}
              selected={startModes.selected}
              hook="start-mode"
            />
          </FormField>
          <FormField label={START_SHEET_TEXT.existingSession}>
            <SelectTrigger value={startModes.source} leading={<MessageSquare />} />
          </FormField>
        </>
      )}
      <FormField label={START_SHEET_TEXT.targetBranch} hint={START_SHEET_TEXT.targetBranchHint}>
        <SelectTrigger value={target} leading={<GitBranch />} mono />
      </FormField>
      <FormField
        label="Runtime and model"
        hint={
          reuse ? (
            <>
              <span data-when="idle">{START_SHEET_TEXT.reuseModelHint}</span>
              <span data-when="busy">{START_SHEET_TEXT.startingModelHint}</span>
            </>
          ) : undefined
        }
      >
        <SelectTrigger
          value={model}
          detail={RUNTIME_LABELS[session.runtime]}
          leading={<RuntimeIcon kind={session.runtime} />}
          disabled={reuse}
        />
      </FormField>
      <FormField label="Effort" value={session.effort}>
        <StepSlider
          stops={efforts.length}
          value={efforts.indexOf(session.effort)}
          fill="effort"
          disabled={reuse}
        />
      </FormField>
      {session.speed && (
        <FormField label="Speed" value="Standard" hint={START_SHEET_TEXT.speedHint}>
          <StepSlider stops={2} value={0} fill="standard" mark={<ZapOff />} />
        </FormField>
      )}
      {goal && (
        <SwitchCard
          label={START_SHEET_TEXT.goalMode}
          description={START_SHEET_TEXT.goalModeDescription}
          on={false}
        />
      )}
      <SwitchCard
        label={START_SHEET_TEXT.customize}
        description={START_SHEET_TEXT.customizeDescription}
        on={false}
      />
    </WorkflowSheet>
  );
}
