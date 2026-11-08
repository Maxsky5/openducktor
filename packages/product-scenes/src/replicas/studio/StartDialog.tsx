// The session start modal of session-start-modal.tsx. Session Mode shows only when the launch
// action allows more than one mode. Reuse and fork are disabled when no session exists yet.
// Reuse mode keeps the model of the existing session. The target branch shows for the
// implementation start and the pull request launch actions. A start from the task actions of
// the board or the command palette can also run in the background. A model with more than one
// speed shows Speed next to Effort, and a fresh session starts at Standard.
import { X, ZapOff } from "lucide-react";
import type { ReactElement } from "react";
import { modelName } from "../../sample/models";
import type { Session } from "../../sample/sessions";
import { flag } from "../flag";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { Segment } from "../ui/Segment";
import { Segmented } from "../ui/Segmented";
import { Switch } from "../ui/Switch";
import "./StartDialog.css";

type Mode = "fresh" | "reuse" | "fork";

type StartDialogProps = {
  role: "Planner" | "Builder" | "QA";
  description: string;
  session: Session;
  modes?: readonly Mode[];
  mode?: Mode;
  existing?: string;
  target?: string;
  /** The dialog offers Run in background next to Start session. */
  background?: boolean;
};

const MODE_LABELS = {
  fresh: "Start fresh",
  reuse: "Reuse existing",
  fork: "Fork existing",
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
      <b>Session Mode</b>
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

function ModelFields({ session, readOnly }: { session: Session; readOnly: boolean }): ReactElement {
  return (
    <div className="st-field-row">
      <div className="st-field">
        <b>Runtime and model</b>
        <Combobox data-disabled={flag(readOnly)}>
          <RuntimeIcon kind={session.runtime} />
          <span>{modelName(session)}</span>
        </Combobox>
      </div>
      <div className="st-field-pair">
        <div className="st-field">
          <b>Effort</b>
          <Combobox data-disabled={flag(readOnly)}>
            <span>{session.effort}</span>
          </Combobox>
        </div>
        {session.speed && (
          <div className="st-field st-speed-field">
            <b>Speed</b>
            <Combobox data-disabled={flag(readOnly)}>
              <ZapOff className="i14" />
              <span>Standard</span>
            </Combobox>
          </div>
        )}
      </div>
    </div>
  );
}

export function StartDialog({
  role,
  description,
  session,
  modes = [],
  mode = "fresh",
  existing,
  target,
  background = false,
}: StartDialogProps): ReactElement {
  return (
    <div className="st-overlay">
      <div className="st-dialog" data-dialog-box="">
        <span className="st-dialog-close">
          <X />
        </span>
        <div className="st-dialog-head">
          <b>Start {role} Session</b>
          <p>{description}</p>
        </div>
        <div className="st-dialog-body">
          {modes.length > 1 && <ModeField modes={modes} mode={mode} existing={existing} />}
          {existing && (
            <div className="st-field">
              <b>Existing Session</b>
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
          <div className="st-switch-row">
            <Switch />
            Customize kickoff prompt
          </div>
        </div>
        <div className="st-dialog-foot">
          <Button variant="outline">Cancel</Button>
          <span className="st-dialog-actions">
            {background && (
              <Button variant="secondary" data-background>
                Run in background
              </Button>
            )}
            <Button data-start>Start session</Button>
          </span>
        </div>
      </div>
    </div>
  );
}
