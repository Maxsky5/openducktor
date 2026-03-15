import type { IssueType } from "@openducktor/contracts";
import { Check } from "lucide-react";
import type { ReactElement } from "react";
import { ISSUE_TYPE_OPTIONS } from "@/components/features/task-composer/constants";
import { cn } from "@/lib/utils";

type IssueTypeGridProps = {
  selectedIssueType: IssueType | null;
  onSelectIssueType: (issueType: IssueType) => void;
};

export function IssueTypeGrid({
  selectedIssueType,
  onSelectIssueType,
}: IssueTypeGridProps): ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2 mt-5">
      {ISSUE_TYPE_OPTIONS.map((option) => {
        const selected = selectedIssueType === option.value;
        const Icon = option.icon;
        const isDisabled = option.disabled === true;
        return (
          <button
            key={option.value}
            type="button"
            disabled={isDisabled}
            className={cn(
              "group min-h-36 rounded-xl border p-4 text-left transition-colors",
              isDisabled
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              option.accentClass,
            )}
            onClick={() => {
              if (!isDisabled) {
                onSelectIssueType(option.value);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <span
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-lg",
                  option.iconClass,
                )}
              >
                <Icon className="size-4" />
              </span>
              {!isDisabled && (
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full border transition-colors",
                    selected ? option.indicatorClass : "border-input bg-card text-transparent",
                  )}
                >
                  <Check className="size-3.5" />
                </span>
              )}
            </div>
            <p className="mt-3 text-base font-semibold text-foreground">{option.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isDisabled && option.disabledText ? option.disabledText : option.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
