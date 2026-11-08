// The startup progress of session-startup-dialog-progress.tsx and session-startup-trace.tsx, as a
// dialog shows it while a new worktree and its session start: the origin, the step count, and one
// row for each step. A step with details has the chevron of its collapsed details, and the other
// rows keep the chevron column. A scene moves `data-state` of each step and the count. The startup
// notification shows the same rows with `StartupSteps`.
import { Check, ChevronRight, Circle, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import "./StartupProgress.css";

/** A step of the startup, by the ids of the host. */
export type StartupStep = { id: string; label: string; details: boolean };

/** The row states of a step that the scenes show. */
export type StepState = "pending" | "running" | "completed";

type StartupProgressProps = {
  /** The repository and the scope, such as `fieldnotes · Workspace session`. */
  origin: string;
  steps: readonly StartupStep[];
};

export function StartupProgress({ origin, steps }: StartupProgressProps): ReactElement {
  return (
    <div className="su" data-startup="">
      <div className="su-head">
        <p>{origin}</p>
        <p className="su-count">
          <span data-step-count="">0</span>
          {` of ${steps.length} steps`}
        </p>
      </div>
      <StartupSteps steps={steps} />
    </div>
  );
}

type StartupStepsProps = {
  steps: readonly StartupStep[];
  /** The state of each row in the markup. */
  state?: StepState;
};

/** The rows of the steps, as session-startup-trace.tsx draws them. */
export function StartupSteps({ steps, state = "pending" }: StartupStepsProps): ReactElement {
  return (
    <ul className="su-steps">
      {steps.map((step) => (
        <li className="su-step" data-step={step.id} data-state={state} key={step.id}>
          <span className="su-icon">
            <Circle className="su-pending" />
            <LoaderCircle className="su-running spin" />
            <Check className="su-completed" />
          </span>
          <span className="su-label">{step.label}</span>
          <small className="su-pending">Pending</small>
          <small className="su-running">Running</small>
          <span className="su-chevron">{step.details && <ChevronRight />}</span>
        </li>
      ))}
    </ul>
  );
}
