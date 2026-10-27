import type { TaskAssetStageResult } from "@openducktor/contracts";
import { ListTodo } from "lucide-react";
import type { ReactElement } from "react";
import { ISSUE_TYPE_OPTIONS } from "@/components/features/task-composer/constants";
import {
  issueTypeGuidance,
  REMOVE_WORKTREE_ON_CLOSE_LABEL,
  removeWorktreeOnCloseChoiceKey,
  removeWorktreeOnCloseChoices,
} from "@openducktor/frontend-core/tasks/create/task-composer-options";
import TaskDescriptionEditor from "@/components/features/task-description-editor/task-description-editor";
import type { IssueImageContext } from "@/components/features/issue-source/github-issue-image";
import type { TaskDescriptionAssetUpload } from "@openducktor/frontend-core/tasks/description/use-task-description-asset-draft";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagSelector } from "@/components/ui/tag-selector";
import { cn } from "@/lib/utils";
import { useGlobalRemoveWorktreeOnClose } from "@openducktor/frontend-core/queries/use-global-remove-worktree-on-close";
import type {
  ComposerMode,
  ComposerState,
} from "@openducktor/frontend-core/tasks/create/task-composer-types";

type TaskDetailsFormProps = {
  mode: ComposerMode;
  disabled: boolean;
  state: ComposerState;
  priorityOptions: ComboboxOption[];
  knownLabels: string[];
  onStateChange: (patch: Partial<ComposerState>) => void;
  onRequestTypeChange: () => void;
  workspaceId: string | null;
  taskId: string | null;
  issueImageContext?: IssueImageContext | undefined;
  onDescriptionImageUpload(file: File): Promise<TaskAssetStageResult>;
  descriptionAssetUploads: TaskDescriptionAssetUpload[];
  descriptionAssetPreviews: ReadonlyMap<string, string>;
};

export function TaskDetailsForm({
  mode,
  disabled,
  state,
  priorityOptions,
  knownLabels,
  onStateChange,
  onRequestTypeChange,
  workspaceId,
  taskId,
  issueImageContext,
  onDescriptionImageUpload,
  descriptionAssetUploads,
  descriptionAssetPreviews,
}: TaskDetailsFormProps): ReactElement {
  const selectedType = ISSUE_TYPE_OPTIONS.find((option) => option.value === state.issueType);
  const SelectedIcon = selectedType?.icon ?? ListTodo;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label>Issue Type *</Label>
        <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
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
            searchPlaceholder="Search priority…"
            onValueChange={(nextValue) => {
              const parsed = Number(nextValue);
              if (!Number.isNaN(parsed)) {
                onStateChange({ priority: parsed });
              }
            }}
          />
        </div>
        <RemoveWorktreeOnCloseField
          value={state.removeWorktreeOnClose}
          onChange={(removeWorktreeOnClose) => onStateChange({ removeWorktreeOnClose })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-description">Description</Label>
        <TaskDescriptionEditor
          key={`${workspaceId ?? "no-workspace"}:${taskId ?? "new-task"}`}
          disabled={disabled}
          markdown={state.description}
          workspaceId={workspaceId}
          taskId={taskId}
          issueImageContext={issueImageContext}
          onUpload={onDescriptionImageUpload}
          uploads={descriptionAssetUploads}
          previews={descriptionAssetPreviews}
          onChange={(description) => onStateChange({ description })}
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

const REMOVE_WORKTREE_ON_CLOSE_LABEL_ID = "task-remove-worktree-on-close-label";

function RemoveWorktreeOnCloseField({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}): ReactElement {
  const choices = removeWorktreeOnCloseChoices(useGlobalRemoveWorktreeOnClose().data);
  return (
    <div className="grid gap-2">
      <Label id={REMOVE_WORKTREE_ON_CLOSE_LABEL_ID}>{REMOVE_WORKTREE_ON_CLOSE_LABEL}</Label>
      <Combobox
        value={removeWorktreeOnCloseChoiceKey(value)}
        options={choices.map(({ key, label, description }) => ({ value: key, label, description }))}
        searchable={false}
        triggerAriaLabelledBy={REMOVE_WORKTREE_ON_CLOSE_LABEL_ID}
        onValueChange={(key) => {
          const choice = choices.find((entry) => entry.key === key);
          if (choice) onChange(choice.value);
        }}
      />
    </div>
  );
}
