import { Check, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export type StepperStep<Id extends string> = {
  id: Id;
  title: string;
  shortTitle?: string;
  description: string;
};

type StepperProps<Id extends string> = {
  steps: readonly StepperStep<Id>[];
  step: Id;
  label: string;
  fill?: boolean;
  onStepChange?: (step: Id) => void;
};

export function Stepper<Id extends string>({
  steps,
  step,
  label,
  fill = false,
  onStepChange,
}: StepperProps<Id>): ReactElement {
  const activeIndex = steps.findIndex((item) => item.id === step);

  return (
    <ol
      aria-label={label}
      className={cn(
        "flex items-stretch gap-1 overflow-x-auto p-1 sm:gap-3",
        fill ? "w-full" : "mx-auto w-max max-w-full",
      )}
    >
      {steps.map((item, index) => {
        const isActive = index === activeIndex;
        const isComplete = index < activeIndex;
        const canSelect = Boolean(onStepChange && index <= activeIndex);
        const cardClassName = cn(
          "flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-2 text-left sm:min-w-44 sm:gap-3 sm:px-3 sm:py-2.5",
          fill && "flex-1",
          isActive && "border-info-border bg-info-surface",
          isComplete && "border-success-border bg-success-surface",
          !isActive && !isComplete && "border-border bg-card",
          canSelect && "cursor-pointer transition-colors hover:border-primary/50",
        );
        const content = (
          <>
            <span
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold sm:size-7",
                isActive && "border-info-border bg-info-surface text-info-surface-foreground",
                isComplete &&
                  "border-success-border bg-success-surface text-success-surface-foreground",
                !isActive && !isComplete && "border-input bg-muted text-muted-foreground",
              )}
            >
              {isComplete ? <Check className="size-4" /> : index + 1}
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="block text-xs font-semibold leading-tight text-foreground sm:hidden">
                {item.shortTitle ?? item.title}
              </span>
              <span className="hidden text-sm font-semibold text-foreground sm:block">
                {item.title}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {item.description}
              </span>
            </span>
          </>
        );

        return (
          <li
            key={item.id}
            aria-current={isActive ? "step" : undefined}
            className={cn("flex min-w-0 items-center gap-1 sm:gap-3", fill && "flex-1")}
          >
            {onStepChange ? (
              <button
                type="button"
                className={cardClassName}
                disabled={!canSelect}
                onClick={() => onStepChange(item.id)}
              >
                {content}
              </button>
            ) : (
              <div className={cardClassName}>{content}</div>
            )}
            {index < steps.length - 1 ? (
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 sm:size-5",
                  isComplete ? "text-success-accent" : "text-muted-foreground/40",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
