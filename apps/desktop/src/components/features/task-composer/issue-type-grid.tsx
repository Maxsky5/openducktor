import { Check } from "lucide-react";
import type { ReactElement } from "react";
import {
  ISSUE_TYPE_DEFAULTS,
  ISSUE_TYPE_OPTIONS,
} from "@/components/features/task-composer/constants";
import { cn } from "@/lib/utils";
import type { ComposerState } from "@/types/task-composer";

type IssueTypeGridProps = {
  state: ComposerState;
  onStateChange: (patch: Partial<ComposerState>) => void;
};

export function IssueTypeGrid({ state, onStateChange }: IssueTypeGridProps): ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ISSUE_TYPE_OPTIONS.map((option) => {
        const selected = state.issueType === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "group min-h-36 cursor-pointer rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              selected
                ? option.accentClass
                : "border-border bg-card text-foreground hover:border-input hover:bg-muted",
            )}
            onClick={() =>
              onStateChange({
                issueType: option.value,
                aiReviewEnabled: ISSUE_TYPE_DEFAULTS[option.value].aiReviewEnabled,
                parentId: option.supportsParent ? state.parentId : "",
              })
            }
          >
            <div className="flex items-start justify-between gap-3">
              <span
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-lg",
                  selected ? option.iconClass : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full border transition-colors",
                  selected
                    ? "border-info-border bg-info-surface text-info-muted"
                    : "border-input bg-card text-transparent",
                )}
              >
                <Check className="size-3.5" />
              </span>
            </div>
            <p className="mt-3 text-base font-semibold text-foreground">{option.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
          </button>
        );
      })}
    </div>
  );
}
