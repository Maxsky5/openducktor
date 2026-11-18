// The startup progress of a session start that sets up a worktree, as StartupTrace of
// startup-trace.tsx and StartupStepRow of startup-step-row.tsx in
// apps/mobile/src/features/session-startup show it in the start sheet: the header with the icon
// of the phase, the phase, and the origin of the start, the steps along a guide line, and Continue
// in background under a hairline. The steps are the rows of startupTraceRows in
// packages/frontend-core: the setup steps of the worktree, then the session start.
// start-progress.ts changes `data-phase` of the trace and `data-state` of each step.
import { Check, Circle, Layers, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import "./StartupTrace.css";

/** PHASE_LABELS of startup-trace.tsx for the phases that a start that works shows. */
export const STARTUP_PHASES = {
  running: "Starting session",
  ready: "Session ready",
} as const;

/** The states of a step that a start that works shows, as STEP_ICONS of startup-step-row.tsx. */
export type StartupStepState = "pending" | "running" | "completed";

/** A step of the start, by its id of the host. */
export type StartupTraceStep = { id: string; label: string };

/** The label of the action that keeps the start running and closes the sheet. */
export const CONTINUE_IN_BACKGROUND = "Continue in background";

/** The icon of each step state: a circle, the spinner, or a check. */
function StepIcons(): ReactElement {
  return (
    <>
      <span className="mob-startup-glyph" data-icon="pending">
        <Circle />
      </span>
      <span className="mob-startup-glyph" data-icon="running">
        <LoaderCircle className="spin" />
      </span>
      <span className="mob-startup-glyph" data-icon="completed">
        <Check />
      </span>
    </>
  );
}

export function StartupTrace({
  origin,
  steps,
}: {
  /** The workspace, the task, and the role, as `fieldnotes · fieldnotes-k3x9 · build`. */
  origin: string;
  steps: readonly StartupTraceStep[];
}): ReactElement {
  return (
    <div className="mob-startup" data-startup="" data-phase="running">
      <div className="mob-startup-head">
        <span className="mob-startup-phase">
          <span className="mob-startup-phase-icon" data-phase-icon="running">
            <LoaderCircle className="spin" />
          </span>
          <span className="mob-startup-phase-icon" data-phase-icon="ready">
            <Check />
          </span>
        </span>
        <span className="mob-startup-heading">
          <span className="mob-startup-title">
            <b data-phase-title="running">{STARTUP_PHASES.running}</b>
            <b data-phase-title="ready">{STARTUP_PHASES.ready}</b>
          </span>
          <span className="mob-startup-origin">{origin}</span>
        </span>
      </div>
      <div className="mob-startup-steps">
        {steps.map((step) => (
          <div
            className="mob-startup-step"
            key={step.id}
            data-startup-step={step.id}
            data-state="pending"
          >
            <span className="mob-startup-icon">
              <StepIcons />
            </span>
            <span className="mob-startup-label">{step.label}</span>
          </div>
        ))}
      </div>
      <div className="mob-startup-actions">
        <span className="mob-startup-action">
          <Layers />
          {CONTINUE_IN_BACKGROUND}
        </span>
      </div>
    </div>
  );
}
