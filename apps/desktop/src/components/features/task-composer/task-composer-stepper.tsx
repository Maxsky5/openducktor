import { cn } from "@/lib/utils";
import type { ComposerStep } from "@/types/task-composer";
import { Check } from "lucide-react";
import type { ReactElement } from "react";

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
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <button
          type="button"
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
            isTypeStep ? "border-sky-300 bg-sky-50" : "border-emerald-200 bg-emerald-50/70",
          )}
          onClick={() => onStepChange("type")}
        >
          <span
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              isTypeStep
                ? "border-sky-400 bg-sky-100 text-sky-800"
                : "border-emerald-300 bg-emerald-100 text-emerald-700",
            )}
          >
            {isTypeStep ? 1 : <Check className="size-4" />}
          </span>
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold text-slate-900">Issue Type</span>
            <span className="block text-xs text-slate-500">Choose the task category</span>
          </span>
        </button>

        <span
          className={cn("h-px w-8 rounded-full", isDetailsStep ? "bg-emerald-300" : "bg-slate-300")}
        />

        <button
          type="button"
          className={cn(
            "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
            isDetailsStep
              ? "cursor-pointer border-sky-300 bg-sky-50"
              : "cursor-not-allowed border-slate-200 bg-white text-slate-400",
          )}
          disabled={!isDetailsStep}
          onClick={() => onStepChange("details")}
        >
          <span
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
              isDetailsStep
                ? "border-sky-400 bg-sky-100 text-sky-800"
                : "border-slate-300 bg-slate-100 text-slate-500",
            )}
          >
            2
          </span>
          <span className="space-y-0.5">
            <span className="block text-sm font-semibold text-slate-900">Task Details</span>
            <span className="block text-xs text-slate-500">Add required metadata</span>
          </span>
        </button>
      </div>
    </div>
  );
}
