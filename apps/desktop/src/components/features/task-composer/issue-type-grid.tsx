import {
  ISSUE_TYPE_DEFAULTS,
  ISSUE_TYPE_OPTIONS,
} from "@/components/features/task-composer/constants";
import { cn } from "@/lib/utils";
import type { ComposerState } from "@/types/task-composer";
import { Check } from "lucide-react";
import type { ReactElement } from "react";

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
              "group min-h-36 cursor-pointer rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40",
              selected
                ? option.accentClass
                : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
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
                  selected ? option.iconClass : "bg-slate-100 text-slate-600",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full border transition-colors",
                  selected
                    ? "border-sky-300 bg-sky-100 text-sky-700"
                    : "border-slate-300 bg-white text-transparent",
                )}
              >
                <Check className="size-3.5" />
              </span>
            </div>
            <p className="mt-3 text-base font-semibold text-slate-900">{option.label}</p>
            <p className="mt-1 text-sm text-slate-600">{option.description}</p>
          </button>
        );
      })}
    </div>
  );
}
