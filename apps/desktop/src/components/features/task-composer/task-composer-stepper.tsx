import { Check, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { ComposerStep } from "@/types/task-composer";

type TaskComposerStepperProps = {
  step: ComposerStep;
  onStepChange: (step: ComposerStep) => void;
};

export function TaskComposerStepper({
  step,
  onStepChange,
}: TaskComposerStepperProps): ReactElement {
  const isTypeStep = step === "type";
  const isDetailsStep = step === "details";

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
            isTypeStep
              ? "border-info-border bg-info-surface"
              : "border-success-border bg-success-surface",
          )}
          onClick={() => onStepChange("type")}
        >
          <span
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              isTypeStep
                ? "border-info-border bg-info-surface text-info-surface-foreground"
                : "border-success-border bg-success-surface text-success-surface-foreground",
            )}
          >
            {isTypeStep ? 1 : <Check className="size-4" />}
          </span>
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold text-foreground">Issue Type</span>
            <span className="block text-xs text-muted-foreground">Choose the task category</span>
          </span>
        </button>

        <ChevronRight
          className={cn("size-5", isDetailsStep ? "text-success-accent" : "text-muted-foreground/40")}
        />

        <button
          type="button"
          className={cn(
            "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
            isDetailsStep
              ? "cursor-pointer border-info-border bg-info-surface"
              : "cursor-not-allowed border-border bg-card text-muted-foreground",
          )}
          disabled={!isDetailsStep}
          onClick={() => onStepChange("details")}
        >
          <span
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              isDetailsStep
                ? "border-info-border bg-info-surface text-info-surface-foreground"
                : "border-input bg-muted text-muted-foreground",
            )}
          >
            2
          </span>
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold text-foreground">Task Details</span>
            <span className="block text-xs text-muted-foreground">Add required metadata</span>
          </span>
        </button>
      </div>
    </div>
  );
}
