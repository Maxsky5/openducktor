// The session start modal of session-start-modal.tsx. Session mode shows only when the launch
// action allows more than one mode. Reuse and fork are disabled when no session exists yet.
// Reuse mode keeps the model of the existing session. The target branch shows for the
// implementation start and the pull request launch actions. A start from the task actions of
// the board or the command palette can also run in the background: the dialog then closes, and the
// startup notification shows the progress. A model with more than one
// speed shows Speed next to Effort, and a fresh session starts at Standard. The title names the
// role, and the description follows the start modes, as use-session-start-modal-coordinator.ts
// builds them. A launch with a goal shows the Goal mode switch above Customize first message, and
// a start that makes a new worktree shows its startup progress in the dialog.
import { Layers, Play, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { Session } from "../../sample/sessions";
import { flag } from "../flag";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Segment } from "../ui/Segment";
import { Segmented } from "../ui/Segmented";
import { Switch } from "../ui/Switch";
import { GoalField } from "./GoalField";
import { ModelFields } from "./ModelFields";
import "./StartDialog.css";

type Mode = "fresh" | "reuse" | "fork";

type StartDialogProps = {
  role: "Planner" | "Builder" | "QA";
  session: Session;
  modes?: readonly Mode[];
  mode?: Mode;
  existing?: string;
  target?: string;
  /** The dialog offers Run in background next to Start session. */
  background?: boolean;
  /**
   * The launch offers Goal mode: Start Implementation, Fix QA Rejection, and Apply Human Changes of
   * the built-in workflow.
   */
  goal?: boolean;
  /** The default goal of the launch, which a scene shows when it turns Goal mode on. */
  goalText?: string;
  /** The startup progress, which shows after Start session. */
  progress?: ReactNode;
};

const MODE_LABELS = {
  fresh: "Start fresh",
  reuse: "Reuse existing",
  fork: "Fork existing",
} as const satisfies Record<Mode, string>;

/** The description of a dialog with one start mode. */
const MODE_DESCRIPTIONS = {
  fresh: "Start a new session.",
  reuse: "Continue an existing session.",
  fork: "Fork an existing session.",
} as const satisfies Record<Mode, string>;

function ModeField({
  modes,
  mode,
  existing,
}: {
  modes: readonly Mode[];
  mode: Mode;
  existing: string | undefined;
}): ReactElement {
  return (
    <div className="st-field">
      <b>Session mode</b>
      <Segmented size="lg" className="st-modes">
        {modes.map((item) => (
          <Segment
            active={item === mode}
            disabled={item !== "fresh" && !existing}
            data-mode={item}
            key={item}
          >
            {MODE_LABELS[item]}
          </Segment>
        ))}
      </Segmented>
    </div>
  );
}

export function StartDialog({
  role,
  session,
  modes = [],
  mode = "fresh",
  existing,
  target,
  background = false,
  goal = false,
  goalText,
  progress,
}: StartDialogProps): ReactElement {
  return (
    <div className="st-overlay">
      <div className="st-dialog" data-dialog-box="">
        <span className="st-dialog-close">
          <X />
        </span>
        <div className="st-dialog-head">
          <b>Start {role} session</b>
          <p>{modes.length > 1 ? "Choose how to start this session." : MODE_DESCRIPTIONS[mode]}</p>
        </div>
        <div className="st-dialog-body">
          {modes.length > 1 && <ModeField modes={modes} mode={mode} existing={existing} />}
          {existing && (
            <div className="st-field">
              <b>Existing session</b>
              <Combobox>
                <span>{existing}</span>
                <small className="st-latest">Latest</small>
              </Combobox>
            </div>
          )}
          {target && (
            <div className="st-field">
              <b>Target branch</b>
              <Combobox branch>
                <span>{target}</span>
              </Combobox>
            </div>
          )}
          <ModelFields session={session} readOnly={mode === "reuse"} />
          <div className="st-instructions">
            {goal && <GoalField text={goalText} />}
            <div className="st-kickoff" data-after-goal={flag(goal)} data-kickoff="">
              <div className="st-switch-row">
                <Switch />
                Customize first message
              </div>
            </div>
          </div>
        </div>
        <div className="st-dialog-foot">
          <Button variant="outline">Cancel</Button>
          <span className="st-dialog-actions">
            {background && (
              <Button variant="secondary" data-background>
                <Layers className="i16" />
                Run in background
              </Button>
            )}
            <Button data-start>
              <Play className="i16" />
              Start session
            </Button>
          </span>
        </div>
        {progress && (
          <div className="st-progress">
            {progress}
            <div className="st-progress-foot">
              <Button variant="secondary" size="sm">
                <Layers className="i16" />
                Continue in background
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
