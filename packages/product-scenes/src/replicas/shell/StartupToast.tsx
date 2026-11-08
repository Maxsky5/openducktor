// The startup notification of session-startup-stack.tsx: a session that runs in the background
// shows its startup in a toast. The title row has the status icon, the title, the step count, and
// the chevron of the progress. The description has the origin and the steps. A start without a
// new worktree has no steps, so its description shows the activity, and its chevron shows only
// when the session is ready. The ready session has the close button and Open. A scene moves
// `data-phase` and the state of each step. A view that ends on the ready session renders it with
// `ready`.
import { ArrowUpRight, Check, ChevronDown, ChevronUp, LoaderCircle, X } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { type StartupStep, StartupSteps } from "../studio/StartupProgress";
import "../studio/StartupProgress.css";
import "./Toast.css";
import "./StartupToast.css";

type StartupToastProps = {
  /** The role of the task session, such as `Builder`. */
  role: string;
  /** The repository and the scope, such as `fieldnotes · fieldnotes-w5j3`. */
  origin: string;
  /** The steps of a new worktree. A start without a new worktree has none. */
  steps?: readonly StartupStep[];
  /** The markup shows the ready session with each step completed. */
  ready?: boolean;
};

/** The titles of a startup notification while the session starts and when it is ready. */
type StartupToastTitles = { running: string; ready: string };

/** The titles of the notification of a task session of `role`, as startup-summary.ts words them. */
export function startupToastTitles(role: string): StartupToastTitles {
  return { running: `Starting ${role} session`, ready: `${role} session ready` };
}

/** The activity of a pending start without steps. */
export const STARTING_ACTIVITY = "Starting session";

export function StartupToast({
  role,
  origin,
  steps = [],
  ready = false,
}: StartupToastProps): ReactElement {
  const trace = steps.length > 0;
  const titles = startupToastTitles(role);
  return (
    <div className="toast sut" data-startup-toast="" data-phase={ready ? "ready" : "running"}>
      <span className="toast-close sut-ready">
        <X />
      </span>
      <div className="sut-title">
        <span className="sut-icon">
          <LoaderCircle className="sut-running spin" />
          <Check className="sut-ready" />
        </span>
        <span className="sut-name">
          <span className="sut-running">{titles.running}</span>
          <span className="sut-ready">{titles.ready}</span>
        </span>
        <span className="sut-meta">
          {trace && (
            <span className="sut-count sut-running">
              <span data-step-count="">{ready ? steps.length : 0}</span>
              {`/${steps.length}`}
            </span>
          )}
          <span className="sut-toggle" data-trace={flag(trace)}>
            {trace ? <ChevronUp /> : <ChevronDown />}
          </span>
        </span>
      </div>
      <div className="sut-body">
        <div className="sut-text">
          <p>{origin}</p>
          {!trace && <p className="sut-running">{STARTING_ACTIVITY}</p>}
        </div>
        {trace && <StartupSteps steps={steps} state={ready ? "completed" : "pending"} />}
      </div>
      <span className="toast-open sut-ready">
        Open
        <ArrowUpRight className="i14" />
      </span>
    </div>
  );
}
