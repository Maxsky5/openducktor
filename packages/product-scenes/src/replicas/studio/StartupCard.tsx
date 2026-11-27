// The startup card of inline-session-startup.tsx at the top of a transcript, while a new
// workspace session starts: the status icon, the title, the step count, and the chevron in the
// toggle, then the startup steps of session-startup-trace.tsx under a border. A ready session shows
// the close button. A clean start folds the card to its title row when the session is ready. A
// scene moves `data-phase`, `data-open`, and the state of each step with startup-card.ts. The
// markup shows the first step of the start: the card is open, and each step is pending.
import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import type { ReactElement } from "react";
import { type StartupStep, StartupSteps } from "./StartupProgress";
import "./StartupCard.css";

/** The titles of the card of a workspace session, as startupTitle of startup-summary.ts words them. */
export const STARTUP_CARD_TITLES = {
  running: "Starting session",
  ready: "Session ready",
} as const;

type StartupCardProps = {
  steps: readonly StartupStep[];
  /** The card is in the markup but shows only later. */
  hidden?: boolean;
};

export function StartupCard({ steps, hidden }: StartupCardProps): ReactElement {
  return (
    <div className="isu-owner" hidden={hidden} data-startup-card="">
      <div className="isu" data-phase="running" data-open="" data-startup-box="">
        <div className="isu-head">
          <span className="isu-toggle" data-startup-toggle="">
            <span className="isu-icon">
              <LoaderCircle className="isu-running spin" />
              <Check className="isu-ready" />
            </span>
            <span className="isu-title">
              <span className="isu-running">{STARTUP_CARD_TITLES.running}</span>
              <span className="isu-ready">{STARTUP_CARD_TITLES.ready}</span>
            </span>
            <span className="isu-count">
              <span data-step-count="">0</span>
              {`/${steps.length}`}
            </span>
            <span className="isu-chevron">
              <ChevronDown />
            </span>
          </span>
          <span className="isu-dismiss isu-ready">
            <X />
          </span>
        </div>
        <div className="isu-body">
          <StartupSteps steps={steps} />
        </div>
      </div>
    </div>
  );
}
