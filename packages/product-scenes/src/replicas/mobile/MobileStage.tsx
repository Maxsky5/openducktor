// The layout of a mobile scene of the documentation. The phone shows the app, and a column at its
// right lists the steps of the scene, with the current step highlighted as the scene plays. A split
// scene puts a desktop window at the left of the phone instead. A phone stage shows only the phone.
// steps.ts moves the highlight.
import { Check } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Replica } from "../Replica";
import "./MobileStage.css";

type MobileStageProps = {
  /** The phone, as `PhoneFrame`. */
  phone: ReactNode;
  /** The steps of the scene, in short sentences. */
  steps?: readonly string[];
  /** The step of the static frame. Its default is the last step. */
  current?: number;
  /** A desktop window at the left of the phone, for a scene with the computer and the phone. */
  lead?: ReactNode;
  /** The parts over the stage, such as the pointer of the desktop window. */
  overlay?: ReactNode;
};

/** The state of a step: done, the current step, or a later step. */
export type StepState = "done" | "current" | "next";

export function MobileStage({
  phone,
  steps,
  current = (steps?.length ?? 0) - 1,
  lead,
  overlay,
}: MobileStageProps): ReactElement {
  let layout = "phone";
  if (lead) layout = "split";
  else if (steps) layout = "steps";
  return (
    <Replica className="mob-stage" data-layout={layout}>
      {lead && <div className="mob-stage-lead">{lead}</div>}
      <div className="mob-stage-phone">{phone}</div>
      {steps && (
        <ol className="mob-steps">
          {steps.map((step, index) => {
            let state: StepState = "next";
            if (index < current) state = "done";
            else if (index === current) state = "current";
            return (
              <li key={step} className="mob-step" data-state={state} data-step-index={index}>
                <span className="mob-step-number">
                  <span>{index + 1}</span>
                  <Check />
                </span>
                <span className="mob-step-text">{step}</span>
              </li>
            );
          })}
        </ol>
      )}
      {overlay}
    </Replica>
  );
}
