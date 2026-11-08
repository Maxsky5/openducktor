// The workflow rail under the header of a task session, as session-workflow-rail.tsx in
// apps/mobile/src/features/session/header: Spec, Planner, Builder, and QA as tiles of equal width,
// each with the role icon and the mark of its state over the role name. The step of the session
// has a ring. A scene changes `data-tone` and `data-mark` of a step, and `data-tone` of the
// connector before it.
import {
  Check,
  Circle,
  CircleDashed,
  CircleDotDashed,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { Fragment, type ReactElement } from "react";
import { flag } from "../flag";
import { RoleIcon } from "../ui/RoleIcon";
import { ROLE_LABELS, ROLES, type RoleId } from "../vocabulary";
import "./MobileRail.css";

/** The workflow tones of a step, as WorkflowStepTone. */
export type RailTone =
  | "in_progress"
  | "done"
  | "available"
  | "optional"
  | "rejected"
  | "waiting_input"
  | "failed"
  | "blocked";

/**
 * The mark after the role icon, as stateMark: done, a session that waits for input, a working or
 * a paused step, an available or optional step, an alert, or none.
 */
export type RailMark =
  | "done"
  | "waiting"
  | "working"
  | "paused"
  | "available"
  | "optional"
  | "alert"
  | "none";

export type RailStep = { tone: RailTone; mark: RailMark };

type MobileRailProps = {
  steps: Readonly<Record<RoleId, RailStep>>;
  /** The role of the session. Its step has the ring. */
  selected: RoleId;
};

export function MobileRail({ steps, selected }: MobileRailProps): ReactElement {
  return (
    <div className="mob-rail" data-rail="">
      {ROLES.map((role, index) => {
        const step = steps[role];
        return (
          <Fragment key={role}>
            {index > 0 && <i className="mob-rail-link" data-tone={step.tone} data-link={role} />}
            <span className="mob-rail-ring" data-selected={flag(role === selected)}>
              <span
                className="mob-rail-step"
                data-tone={step.tone}
                data-mark={step.mark}
                data-step={role}
              >
                <span className="mob-rail-marks">
                  <RoleIcon role={role} className="mob-rail-role" />
                  <Check className="mob-rail-mark" data-for="done" />
                  <CircleDashed className="mob-rail-mark" data-for="waiting" />
                  <LoaderCircle className="mob-rail-mark spin" data-for="working" />
                  <CircleDotDashed className="mob-rail-mark" data-for="paused" />
                  <Circle className="mob-rail-mark" data-for="available" />
                  <CircleDashed className="mob-rail-mark" data-for="optional" />
                  <TriangleAlert className="mob-rail-mark" data-for="alert" />
                </span>
                <span className="mob-rail-label">{ROLE_LABELS[role]}</span>
              </span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}
