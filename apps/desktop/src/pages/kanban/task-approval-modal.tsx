import { Check, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  PullRequestDraftMode,
  TaskApprovalModalModel,
  TaskApprovalMode,
} from "./kanban-page-model-types";

const APPROVAL_ACTION_OPTIONS: Array<{
  value: TaskApprovalMode;
  label: string;
}> = [
  {
    value: "direct_merge",
    label: "Direct Merge",
  },
  {
    value: "pull_request",
    label: "Pull Request",
  },
];

const MERGE_METHOD_OPTIONS: Array<{
  value: TaskApprovalModalModel["mergeMethod"];
  label: string;
  description: string;
}> = [
  {
    value: "merge_commit",
    label: "Merge Commit",
    description: "Preserve the full branch history with a merge commit.",
  },
  {
    value: "squash",
    label: "Squash",
    description: "Collapse the builder branch into a single commit.",
  },
  {
    value: "rebase",
    label: "Rebase",
    description: "Replay builder commits directly onto the target branch.",
  },
];

const PULL_REQUEST_DRAFT_OPTIONS: Array<{
  value: PullRequestDraftMode;
  label: string;
  description: string;
}> = [
  {
    value: "manual",
    label: "Write Manually",
    description: "Provide the pull request title and description yourself.",
  },
  {
    value: "generate_ai",
    label: "Generate With AI",
    description: "Fork the latest Builder session and draft the pull request automatically.",
  },
];

function SegmentedTabs<TValue extends string>({
  ariaLabel,
  value,
  options,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  value: TValue;
  options: ReadonlyArray<{
    value: TValue;
    label: string;
    disabled?: boolean;
  }>;
  disabled?: boolean;
  onChange: (value: TValue) => void;
}): ReactElement {
  return (
    <div
      className="inline-flex h-10 w-full items-center rounded-lg bg-muted p-1"
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={disabled || option.disabled}
            className={cn(
              "inline-flex h-8 flex-1 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
              (disabled || option.disabled) && "pointer-events-none opacity-50",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function OptionCard<TValue extends string>({
  value,
  selectedValue,
  label,
  description,
  disabled,
  onSelect,
}: {
  value: TValue;
  selectedValue: TValue;
  label: string;
  description: string;
  disabled?: boolean;
  onSelect: (value: TValue) => void;
}): ReactElement {
  const isSelected = value === selectedValue;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(value)}
      className={cn(
        "group grid min-h-32 cursor-pointer gap-1 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        isSelected
          ? "border-info-border bg-info-surface"
          : "border-border bg-card text-foreground hover:border-input hover:bg-muted",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-base font-semibold text-foreground">{label}</span>
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
            isSelected
              ? "border-info-border bg-info-surface text-info-muted"
              : "border-input bg-card text-transparent",
          )}
        >
          <Check className="size-3.5" />
        </span>
      </div>
      <span className="text-sm text-muted-foreground">
        {description}
      </span>
    </button>
  );
}

export function TaskApprovalModal({
  model,
}: {
  model: TaskApprovalModalModel | null;
}): ReactElement | null {
  if (!model) {
    return null;
  }

  const hasManualPullRequestValidationError =
    model.stage === "approval" &&
    model.mode === "pull_request" &&
    model.pullRequestAvailable &&
    model.pullRequestDraftMode === "manual" &&
    (model.title.trim().length === 0 || model.body.trim().length === 0);
  const confirmDisabled =
    model.isLoading ||
    model.isSubmitting ||
    model.hasUncommittedChanges ||
    hasManualPullRequestValidationError;
  const title = model.stage === "push_target" ? "Push Target Branch" : "Approve Task";
  const description =
    model.stage === "push_target"
      ? `The task is already closed locally. Push ${model.publishTarget ?? model.targetBranch} now if you want to publish the merge.`
      : "Choose whether to merge the builder branch directly or create/update a pull request.";
  const dirtyWorktreeMessage =
    model.uncommittedFileCount === 1
      ? "The builder worktree has 1 uncommitted file. Commit or discard it before approving this task."
      : `The builder worktree has ${model.uncommittedFileCount} uncommitted files. Commit or discard them before approving this task.`;
  const actionOptions = APPROVAL_ACTION_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    disabled: option.value === "pull_request" && !model.pullRequestAvailable,
  }));
  let confirmLabel = "Merge Locally";
  if (model.mode === "pull_request") {
    confirmLabel =
      model.pullRequestDraftMode === "manual" ? "Create Pull Request" : "Generate And Create";
  }

  return (
    <Dialog
      open={model.open}
      onOpenChange={(nextOpen) => {
        if (!model.isSubmitting) {
          model.onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader className="space-y-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {model.stage === "approval" ? (
          <div className="space-y-5 pt-2">
            {model.isLoading ? (
              <div className="flex min-h-56 items-center justify-center rounded-xl border border-border bg-muted/30">
                <div className="flex flex-col items-center gap-3 text-center">
                  <LoaderCircle className="size-6 animate-spin text-primary" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Preparing approval options
                    </p>
                    <p className="text-sm text-muted-foreground">
                      OpenDucktor is loading the builder branch and provider readiness.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {model.hasUncommittedChanges ? (
                  <div className="grid gap-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                    <p className="text-sm font-semibold">Uncommitted changes detected</p>
                    <p className="text-sm">{dirtyWorktreeMessage}</p>
                  </div>
                ) : null}

                {model.errorMessage ? (
                  <div className="grid gap-1 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-destructive">
                    <p className="text-sm font-semibold">Approval failed</p>
                    <p className="text-sm">{model.errorMessage}</p>
                  </div>
                ) : null}

                <div className="space-y-3">
                  <Label>Approval Action</Label>
                  <SegmentedTabs
                    ariaLabel="Approval action"
                    value={model.mode}
                    options={actionOptions}
                    disabled={model.isSubmitting}
                    onChange={model.onModeChange}
                  />
                  {!model.pullRequestAvailable && model.pullRequestUnavailableReason ? (
                    <p className="text-sm text-muted-foreground">
                      Pull request unavailable: {model.pullRequestUnavailableReason}
                    </p>
                  ) : null}
                </div>

                {model.mode === "direct_merge" ? (
                  <div className="space-y-3">
                    <Label>Merge Method</Label>
                    <div className="grid gap-3 md:grid-cols-3">
                      {MERGE_METHOD_OPTIONS.map((option) => (
                        <OptionCard
                          key={option.value}
                          value={option.value}
                          selectedValue={model.mergeMethod}
                          label={option.label}
                          description={option.description}
                          disabled={model.isSubmitting}
                          onSelect={model.onMergeMethodChange}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <Label>Pull Request Draft</Label>
                      <div className="grid gap-3 md:grid-cols-2">
                        {PULL_REQUEST_DRAFT_OPTIONS.map((option) => (
                          <OptionCard
                            key={option.value}
                            value={option.value}
                            selectedValue={model.pullRequestDraftMode}
                            label={option.label}
                            description={option.description}
                            disabled={model.isSubmitting}
                            onSelect={model.onPullRequestDraftModeChange}
                          />
                        ))}
                      </div>
                    </div>

                    {model.pullRequestDraftMode === "manual" ? (
                      <div className="grid gap-4 rounded-xl border border-border bg-card p-4">
                        <div className="grid gap-2">
                          <Label htmlFor="task-approval-pr-title">Pull Request Title</Label>
                          <Input
                            id="task-approval-pr-title"
                            value={model.title}
                            disabled={model.isSubmitting}
                            onChange={(event) => model.onTitleChange(event.currentTarget.value)}
                          />
                        </div>

                        <div className="grid gap-2">
                          <Label htmlFor="task-approval-pr-body">Pull Request Description</Label>
                          <Textarea
                            id="task-approval-pr-body"
                            className="min-h-56"
                            value={model.body}
                            disabled={model.isSubmitting}
                            onChange={(event) => model.onBodyChange(event.currentTarget.value)}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                        OpenDucktor will fork the latest Builder session, generate the pull
                        request title and description in the background, then create or update the
                        pull request.
                      </div>
                    )}

                    {model.pullRequestUrl ? (
                      <a
                        href={model.pullRequestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary underline underline-offset-4"
                      >
                        Open existing pull request
                      </a>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {model.stage === "push_target" ? (
          <div className="rounded-md border border-border bg-muted/60 p-3 text-sm text-muted-foreground">
            The merge is already applied locally on <span className="font-mono">{model.targetBranch}</span>.
          </div>
        ) : null}

        <DialogFooter className="justify-between">
          {model.stage === "push_target" ? (
            <>
              <Button type="button" variant="outline" disabled={model.isSubmitting} onClick={model.onSkipPush}>
                Skip
              </Button>
              <Button type="button" disabled={model.isSubmitting} onClick={model.onConfirmPush}>
                Push Target Branch
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={model.isSubmitting}
                onClick={() => model.onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="button" disabled={confirmDisabled} onClick={model.onConfirm}>
                {confirmLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
