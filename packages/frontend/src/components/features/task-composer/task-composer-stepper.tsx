import type { ReactElement } from "react";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import type { ComposerStep } from "@openducktor/frontend-core/tasks/create/task-composer-types";

/** The title and help of each step of the task form. */
const STEP_DISPLAY = {
  type: { title: "Issue type", shortTitle: "Type", description: "Choose the task category" },
  workflow: { title: "Workflow", shortTitle: "Workflow", description: "Choose how the task runs" },
  details: {
    title: "Task details",
    shortTitle: "Details",
    description: "Add a title and description",
  },
} satisfies Record<ComposerStep, Omit<StepperStep<ComposerStep>, "id">>;

type TaskComposerStepperProps = {
  /** The steps of the form, in order, as the controller gives them. */
  steps: readonly ComposerStep[];
  step: ComposerStep;
  onStepChange: (step: ComposerStep) => void;
};

export function TaskComposerStepper({
  steps,
  step,
  onStepChange,
}: TaskComposerStepperProps): ReactElement {
  return (
    <div className="px-4 py-3">
      <Stepper
        steps={steps.map((id) => ({ id, ...STEP_DISPLAY[id] }))}
        step={step}
        label="Task creation stages"
        onStepChange={onStepChange}
      />
    </div>
  );
}
