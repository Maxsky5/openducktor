import { ISSUE_TYPE_OPTIONS } from "@/components/features/task-composer/constants";
import { issueTypeGuidance } from "@/components/features/task-composer/utils";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagSelector } from "@/components/ui/tag-selector";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ComposerMode, ComposerState } from "@/types/task-composer";
import { ListTodo } from "lucide-react";
import type { ReactElement } from "react";

type TaskDetailsFormProps = {
  mode: ComposerMode;
  state: ComposerState;
  canSelectParent: boolean;
  priorityOptions: ComboboxOption[];
  parentOptions: ComboboxOption[];
  knownLabels: string[];
  onStateChange: (patch: Partial<ComposerState>) => void;
  onRequestTypeChange: () => void;
};

export function TaskDetailsForm({
  mode,
  state,
  canSelectParent,
  priorityOptions,
  parentOptions,
  knownLabels,
  onStateChange,
  onRequestTypeChange,
}: TaskDetailsFormProps): ReactElement {
  const selectedType = ISSUE_TYPE_OPTIONS.find((option) => option.value === state.issueType);
  const SelectedIcon = selectedType?.icon ?? ListTodo;

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>Issue Type *</Label>
        <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                selectedType?.iconClass ?? "bg-slate-100 text-slate-700",
              )}
            >
              <SelectedIcon className="size-4" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                {selectedType?.label ?? state.issueType}
              </p>
              <p className="text-xs text-slate-600">{issueTypeGuidance(state.issueType)}</p>
            </div>
          </div>
          {mode === "create" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={onRequestTypeChange}
            >
              Change
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-title">Title *</Label>
        <Input
          id="task-title"
          placeholder="Short task title"
          value={state.title}
          onChange={(event) => onStateChange({ title: event.currentTarget.value })}
        />
      </div>

      <div className={cn("grid gap-4", canSelectParent ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
        <div className="grid gap-2">
          <Label htmlFor="task-priority">Priority *</Label>
          <Combobox
            value={String(state.priority)}
            options={priorityOptions}
            searchPlaceholder="Search priority..."
            onValueChange={(nextValue) => {
              const parsed = Number(nextValue);
              if (!Number.isNaN(parsed)) {
                onStateChange({ priority: parsed });
              }
            }}
          />
        </div>

        {canSelectParent ? (
          <div className="grid gap-2">
            <Label htmlFor="task-parent">Parent (optional)</Label>
            <Combobox
              value={state.parentId.length > 0 ? state.parentId : "__none__"}
              options={parentOptions}
              searchPlaceholder="Search parent task..."
              onValueChange={(nextValue) =>
                onStateChange({ parentId: nextValue === "__none__" ? "" : nextValue })
              }
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-ai-review">AI Review</Label>
        <label
          htmlFor="task-ai-review"
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
        >
          <input
            id="task-ai-review"
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300 accent-sky-600"
            checked={state.aiReviewEnabled}
            onChange={(event) => onStateChange({ aiReviewEnabled: event.currentTarget.checked })}
          />
          <span className="space-y-0.5">
            <span className="block font-semibold text-slate-900">
              Run QA agent before human review
            </span>
            <span className="block text-xs text-slate-500">
              Enabled by default. If disabled, completed tasks go directly to Human Review.
            </span>
          </span>
        </label>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-description">Description</Label>
        <Textarea
          id="task-description"
          rows={4}
          value={state.description}
          placeholder="Problem context, scope, and expected output."
          onChange={(event) => onStateChange({ description: event.currentTarget.value })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-acceptance">Acceptance Criteria</Label>
        <Textarea
          id="task-acceptance"
          rows={3}
          value={state.acceptanceCriteria}
          placeholder="Concrete pass/fail criteria."
          onChange={(event) => onStateChange({ acceptanceCriteria: event.currentTarget.value })}
        />
      </div>

      <div className="grid gap-2">
        <Label>Labels</Label>
        <TagSelector
          value={state.labels}
          suggestions={knownLabels}
          onChange={(nextLabels) => onStateChange({ labels: nextLabels })}
        />
      </div>
    </div>
  );
}
