import type { ReactElement } from "react";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import type { ComposerStep } from "@/types/task-composer";

const TASK_STEPS: readonly StepperStep<ComposerStep>[] = [
  { id: "type", title: "Issue Type", shortTitle: "Type", description: "Choose the task category" },
  {
    id: "details",
    title: "Task Details",
    shortTitle: "Details",
    description: "Add required metadata",
  },
];

type TaskComposerStepperProps = {
  step: ComposerStep;
  onStepChange: (step: ComposerStep) => void;
};

export function TaskComposerStepper({
  step,
  onStepChange,
}: TaskComposerStepperProps): ReactElement {
  return (
    <div className="px-4 py-3">
      <Stepper
        steps={TASK_STEPS}
        step={step}
        label="Task creation stages"
        onStepChange={onStepChange}
      />
    </div>
  );
}
