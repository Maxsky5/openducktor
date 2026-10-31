import { Check } from "lucide-react";
import type { ReactElement } from "react";
import { ISSUE_TYPE_OPTIONS } from "@/components/features/task-composer/constants";
import { cn } from "@/lib/utils";
import type { BuiltinIssueTypeId as IssueType } from "@openducktor/workflows";

type IssueTypeGridProps = {
  selectedIssueType: IssueType | null;
  onSelectIssueType: (issueType: IssueType) => void;
};

export function IssueTypeGrid({
  selectedIssueType,
  onSelectIssueType,
}: IssueTypeGridProps): ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-3 mt-5">
      {ISSUE_TYPE_OPTIONS.map((option) => {
        const selected = selectedIssueType === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-36 sm:grid-cols-[1fr_auto]",
              selected && option.accentClass,
            )}
            onClick={() => onSelectIssueType(option.value)}
          >
            <span
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                option.iconClass,
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 sm:col-span-2 sm:row-start-2">
              <p className="text-sm font-semibold text-foreground sm:text-base">{option.label}</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{option.description}</p>
            </div>
            <span
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors sm:col-start-2 sm:row-start-1",
                selected ? option.indicatorClass : "border-input bg-card text-transparent",
              )}
            >
              <Check className="size-3.5" aria-hidden="true" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
