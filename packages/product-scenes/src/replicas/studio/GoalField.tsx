// The Goal mode switch of session-start-goal-field.tsx, and the goal field that it shows. The
// launches with a goal of the built-in workflow offer it: Start Implementation, Fix QA Rejection,
// and Apply Human Changes. The switch is off each time the dialog opens. Turned on, the field opens
// like an accordion with the default goal, and Customize first message closes. Generate goal asks a
// model for a goal, and the result replaces the text. start-dialog.ts plays these steps.
import { LoaderCircle, Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import "./GoalField.css";

/** The launch actions of the built-in workflow that declare a goal, so their dialogs offer it. */
export const GOAL_MODE_LAUNCHES = [
  "Start Implementation",
  "Fix QA Rejection",
  "Apply Human Changes",
] as const;

/** The fixed text of the goal field. */
const GOAL_FIELD_TEXT = {
  label: "Goal mode",
  hint: "The agent gets this goal instead of a first message, and works until it is met.",
  generate: "Generate goal",
  generating: "Generating goal…",
} as const;

type GoalFieldProps = {
  /** The default goal of the launch. Without it, the dialog shows only the switch. */
  text?: string | undefined;
  /** The scene turns Goal mode on. */
  on?: boolean;
};

export function GoalField({ text, on = false }: GoalFieldProps): ReactElement {
  return (
    <div className="st-goal" data-goal-field="">
      <div className="st-switch-row">
        <Switch checked={on} data-goal-switch />
        {GOAL_FIELD_TEXT.label}
      </div>
      {text !== undefined && (
        <div className="st-goal-reveal" hidden={!on} data-goal-reveal="">
          <div className="st-goal-group">
            <p className="st-goal-text" data-goal-text="">
              {text}
            </p>
            <div className="st-goal-foot">
              <p>{GOAL_FIELD_TEXT.hint}</p>
              <Button variant="secondary" size="sm" className="st-generate" data-generate>
                <Sparkles className="st-idle" />
                <LoaderCircle className="st-busy spin" />
                <span className="st-idle">{GOAL_FIELD_TEXT.generate}</span>
                <span className="st-busy">{GOAL_FIELD_TEXT.generating}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
