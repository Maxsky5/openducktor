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
            isTypeStep ? "border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/50" : "border-emerald-200 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/40",
          )}
          onClick={() => onStepChange("type")}
        >
          <span
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              isTypeStep
                ? "border-sky-400 dark:border-sky-600 bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                : "border-emerald-300 dark:border-emerald-600 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-200",
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
          className={cn("size-5", isDetailsStep ? "text-emerald-400" : "text-muted-foreground/40")}
        />

        <button
          type="button"
          className={cn(
            "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
            isDetailsStep
              ? "cursor-pointer border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/50"
              : "cursor-not-allowed border-border bg-card text-muted-foreground",
          )}
          disabled={!isDetailsStep}
          onClick={() => onStepChange("details")}
        >
          <span
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              isDetailsStep
                ? "border-sky-400 dark:border-sky-600 bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
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
