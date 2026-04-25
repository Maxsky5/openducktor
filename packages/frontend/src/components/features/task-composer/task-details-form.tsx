import { ListTodo } from "lucide-react";
import type { ReactElement } from "react";
import { ISSUE_TYPE_OPTIONS } from "@/components/features/task-composer/constants";
import { issueTypeGuidance } from "@/components/features/task-composer/utils";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TagSelector } from "@/components/ui/tag-selector";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ComposerMode, ComposerState } from "@/types/task-composer";

type TaskDetailsFormProps = {
  mode: ComposerMode;
  state: ComposerState;
  priorityOptions: ComboboxOption[];
  knownLabels: string[];
  onStateChange: (patch: Partial<ComposerState>) => void;
  onRequestTypeChange: () => void;
};

export function TaskDetailsForm({
  mode,
  state,
  priorityOptions,
  knownLabels,
  onStateChange,
  onRequestTypeChange,
}: TaskDetailsFormProps): ReactElement {
  const selectedType = ISSUE_TYPE_OPTIONS.find((option) => option.value === state.issueType);
  const SelectedIcon = selectedType?.icon ?? ListTodo;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label>Issue Type *</Label>
        <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-3 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
                selectedType?.iconClass ?? "bg-muted text-foreground",
              )}
            >
              <SelectedIcon className="size-4" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {selectedType?.label ?? state.issueType}
              </p>
              <p className="text-xs text-muted-foreground">{issueTypeGuidance(state.issueType)}</p>
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

      <div className="grid items-start gap-4 md:grid-cols-2">
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
        <div className="grid gap-2">
          <Label htmlFor="task-ai-review">AI Review</Label>
          <div className="flex items-center gap-3 pt-2">
            <Switch
              id="task-ai-review"
              checked={state.aiReviewEnabled}
              onCheckedChange={(checked) => onStateChange({ aiReviewEnabled: checked })}
              className="h-6 w-11 [&>span]:size-5 [&>span[data-state=checked]]:translate-x-5"
            />
            <Label htmlFor="task-ai-review" className="font-semibold text-foreground">
              Run QA agent before human review
            </Label>
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-description">Description</Label>
        <Textarea
          id="task-description"
          rows={6}
          value={state.description}
          placeholder="Problem context, scope, and expected output."
          onChange={(event) => onStateChange({ description: event.currentTarget.value })}
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
