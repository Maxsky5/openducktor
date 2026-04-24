import { AlertTriangle, ArrowRight, Check, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canonicalTargetBranch } from "@/lib/target-branch";
import { cn } from "@/lib/utils";
import type {
  PullRequestDraftMode,
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMissingBuilderWorktreeModalModel,
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
  value: TaskApprovalApprovalModalModel["mergeMethod"];
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
    description:
      "Choose a Builder session to fork, then let Builder create or update the pull request automatically.",
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
      className="inline-flex min-h-11 w-full items-center gap-2 rounded-xl bg-muted/70 p-1"
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
              "inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors",
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
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={() => onSelect(value)}
      className={cn(
        "group grid min-h-36 cursor-pointer gap-2 rounded-2xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        isSelected
          ? "border-info-border bg-info-surface shadow-sm"
          : "border-border bg-card text-foreground hover:border-input hover:bg-muted/60",
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
      <span className="text-sm text-muted-foreground">{description}</span>
    </button>
  );
}

export function getTaskApprovalModalHeader(model: TaskApprovalModalModel): {
  title: string;
  description: string;
} {
  if (model.stage === "missing_builder_worktree") {
    return {
      title: "Builder Worktree Missing",
      description:
        "The builder worktree for this task is no longer available. You can still complete the task or reset the implementation from here.",
    };
  }

  if (model.stage === "complete_direct_merge" && model.publishTarget !== null) {
    const publishTargetLabel = canonicalTargetBranch(model.publishTarget);
    return {
      title: "Publish And Mark Done",
      description: `The local merge is already applied. Push ${publishTargetLabel} to publish it, then move the task to Done.`,
    };
  }

  if (model.stage === "complete_direct_merge") {
    return {
      title: "Complete Direct Merge",
      description:
        "The local merge is already applied. Finish the direct merge workflow to move the task to Done and clean up the builder workspace.",
    };
  }

  return {
    title: "Approve Task",
    description:
      "Choose how to finish this task: merge it locally now, or create and update a pull request.",
  };
}

export function TaskApprovalModalPanel({
  model,
  showHeader = true,
}: {
  model: TaskApprovalModalModel;
  showHeader?: boolean;
}): ReactElement {
  const { title, description } = getTaskApprovalModalHeader(model);
  const sectionLabelClass =
    "text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground";

  return (
    <>
      {showHeader ? (
        <div className="space-y-3 border-b border-border/80 px-6 py-6 pr-16 sm:px-8 sm:pr-20">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      ) : null}

      <DialogBody>
        {model.stage === "approval" ? (
          <TaskApprovalApprovalStage model={model} sectionLabelClass={sectionLabelClass} />
        ) : null}

        {model.stage === "missing_builder_worktree" ? (
          <TaskApprovalMissingBuilderWorktreeStage model={model} />
        ) : null}

        {model.stage === "complete_direct_merge" ? (
          <TaskApprovalCompletionStage model={model} sectionLabelClass={sectionLabelClass} />
        ) : null}
      </DialogBody>
      <TaskApprovalModalFooter model={model} />
    </>
  );
}

function getDirectMergeCompletionContextError(
  model: TaskApprovalCompletionModalModel,
): string | null {
  return model.targetBranch === null
    ? "Missing target branch for direct-merge completion. Refresh approval context and retry."
    : null;
}

function getApprovalSubmitValidation(model: TaskApprovalApprovalModalModel): {
  hasManualPullRequestValidationError: boolean;
  hasSquashCommitMessageSubmitError: boolean;
  showSquashCommitMessageValidationError: boolean;
  confirmDisabled: boolean;
  confirmLabel: string;
} {
  const hasManualPullRequestValidationError =
    model.mode === "pull_request" &&
    model.pullRequestAvailable &&
    model.pullRequestDraftMode === "manual" &&
    (model.title.trim().length === 0 || model.body.trim().length === 0);
  const hasSquashCommitMessageSubmitError =
    model.mode === "direct_merge" &&
    model.mergeMethod === "squash" &&
    model.squashCommitMessage.trim().length === 0;
  const showSquashCommitMessageValidationError =
    hasSquashCommitMessageSubmitError &&
    (model.hasSuggestedSquashCommitMessage || model.squashCommitMessageTouched);

  let confirmLabel = "Merge Locally";
  if (model.mode === "pull_request" && model.pullRequestDraftMode === "manual") {
    confirmLabel = "Create Pull Request";
  } else if (model.mode === "pull_request") {
    confirmLabel = "Start PR Generation";
  }

  return {
    hasManualPullRequestValidationError,
    hasSquashCommitMessageSubmitError,
    showSquashCommitMessageValidationError,
    confirmDisabled:
      model.isLoading ||
      model.isSubmitting ||
      model.hasUncommittedChanges ||
      (model.mode === "pull_request" && !model.pullRequestAvailable) ||
      hasManualPullRequestValidationError ||
      hasSquashCommitMessageSubmitError,
    confirmLabel,
  };
}

function TaskApprovalApprovalStage({
  model,
  sectionLabelClass,
}: {
  model: TaskApprovalApprovalModalModel;
  sectionLabelClass: string;
}): ReactElement {
  const { showSquashCommitMessageValidationError } = getApprovalSubmitValidation(model);
  const actionOptions = APPROVAL_ACTION_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    disabled: option.value === "pull_request" && !model.pullRequestAvailable,
  }));
  const dirtyWorktreeMessage =
    model.uncommittedFileCount === 1
      ? "The builder worktree has 1 uncommitted file. Commit or discard it before approving this task."
      : `The builder worktree has ${model.uncommittedFileCount} uncommitted files. Commit or discard them before approving this task.`;

  if (model.isLoading) {
    return (
      <div className="space-y-6 px-6 py-6 sm:px-8">
        <div className="flex min-h-56 items-center justify-center rounded-2xl border border-border bg-muted/30 px-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <LoaderCircle className="size-6 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Preparing approval options</p>
              <p className="text-sm text-muted-foreground">
                OpenDucktor is loading the builder branch and provider readiness.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-6 py-6 sm:px-8">
      {model.hasUncommittedChanges ? (
        <div className="grid gap-1 rounded-2xl border border-warning-border bg-warning-surface p-4 text-warning-surface-foreground">
          <p className="text-sm font-semibold">Uncommitted changes detected</p>
          <p className="text-sm">{dirtyWorktreeMessage}</p>
        </div>
      ) : null}

      {model.errorMessage ? (
        <div className="grid gap-1 rounded-2xl border border-destructive-border bg-destructive-surface p-4 text-destructive-surface-foreground">
          <p className="text-sm font-semibold">Approval failed</p>
          <p className="text-sm text-destructive-muted">{model.errorMessage}</p>
        </div>
      ) : null}

      <div className="space-y-3">
        <Label className={sectionLabelClass}>Approval Action</Label>
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
        <TaskApprovalDirectMergeSection
          model={model}
          sectionLabelClass={sectionLabelClass}
          showSquashCommitMessageValidationError={showSquashCommitMessageValidationError}
        />
      ) : (
        <TaskApprovalPullRequestSection model={model} sectionLabelClass={sectionLabelClass} />
      )}
    </div>
  );
}

function TaskApprovalMissingBuilderWorktreeStage({
  model,
}: {
  model: TaskApprovalMissingBuilderWorktreeModalModel;
}): ReactElement {
  return (
    <div className="space-y-4 px-6 py-6 sm:px-8">
      <div className="rounded-2xl border border-warning-border bg-warning-surface p-5 text-warning-surface-foreground">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-warning-border/60 bg-card/70 text-warning-muted">
            <AlertTriangle className="size-5" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-warning-surface-foreground">
              Builder worktree not found
            </p>
            <p className="text-sm leading-6 text-warning-surface-foreground">
              OpenDucktor could not load the latest builder worktree for this task. Normal direct
              merge and pull request approval options are unavailable without that workspace.
            </p>
          </div>
        </div>
      </div>

      {model.errorMessage ? (
        <div className="grid gap-1 rounded-2xl border border-destructive-border bg-destructive-surface p-4 text-destructive-surface-foreground">
          <p className="text-sm font-semibold">Recovery action failed</p>
          <p className="text-sm text-destructive-muted">{model.errorMessage}</p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-foreground">Choose the next step</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Complete task closes the review and moves this task to Done. Reset implementation opens
            the existing reset workflow so you can send the task back for more work.
          </p>
        </div>
      </div>
    </div>
  );
}

function TaskApprovalDirectMergeSection({
  model,
  sectionLabelClass,
  showSquashCommitMessageValidationError,
}: {
  model: TaskApprovalApprovalModalModel;
  sectionLabelClass: string;
  showSquashCommitMessageValidationError: boolean;
}): ReactElement {
  return (
    <div className="space-y-3">
      <Label className={sectionLabelClass}>Merge Method</Label>
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

      {model.mergeMethod === "squash" ? (
        <div className="grid gap-2 rounded-2xl border border-border bg-card p-5">
          <Label htmlFor="task-approval-squash-commit-message">Squash Commit Message</Label>
          <Textarea
            id="task-approval-squash-commit-message"
            className="min-h-28"
            placeholder="e.g. feat: add Microsoft login"
            value={model.squashCommitMessage}
            disabled={model.isSubmitting}
            onChange={(event) => model.onSquashCommitMessageChange(event.currentTarget.value)}
          />
          <p className="text-sm text-muted-foreground">
            OpenDucktor prefills this from the oldest commit unique to the builder branch. Edit it
            before creating the single squash commit on{" "}
            <span className="font-mono text-[13px] text-foreground">
              {model.targetBranch?.branch ?? "the target branch"}
            </span>
            .
          </p>
          {showSquashCommitMessageValidationError ? (
            <p className="text-sm text-destructive">
              Enter the squash commit message before merging locally.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TaskApprovalPullRequestSection({
  model,
  sectionLabelClass,
}: {
  model: TaskApprovalApprovalModalModel;
  sectionLabelClass: string;
}): ReactElement {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Label className={sectionLabelClass}>Pull Request Draft</Label>
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
        <div className="grid gap-4 rounded-2xl border border-border bg-card p-5">
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
        <div className="rounded-2xl border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
          OpenDucktor will ask you to choose a Builder session to fork, then start PR generation in
          the shared session-start flow.
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
  );
}

function TaskApprovalCompletionStage({
  model,
  sectionLabelClass,
}: {
  model: TaskApprovalCompletionModalModel;
  sectionLabelClass: string;
}): ReactElement {
  const hasPublishTarget = model.publishTarget !== null;
  const completionContextError = getDirectMergeCompletionContextError(model);
  const completionErrorMessage = completionContextError ?? model.errorMessage;
  const localBranchName = model.targetBranch?.branch ?? "";
  const publishTargetLabel = model.publishTarget ? canonicalTargetBranch(model.publishTarget) : "";

  return (
    <div className="grid gap-4 px-6 py-6 sm:px-8">
      {completionErrorMessage ? (
        <div className="grid gap-1 rounded-2xl border border-destructive-border bg-destructive-surface p-4 text-destructive-surface-foreground">
          <p className="text-sm font-semibold">Direct merge completion failed</p>
          <p className="text-sm text-destructive-muted">{completionErrorMessage}</p>
        </div>
      ) : null}

      {completionContextError ? null : (
        <>
          <div className="rounded-2xl border border-info-border bg-info-surface p-5">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-info-border/60 bg-card/70 text-info-muted">
                <Check className="size-5" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-info-surface-foreground">
                  Local merge ready
                </p>
                <p className="text-sm leading-6 text-info-surface-foreground">
                  The direct merge is already applied on this machine for{" "}
                  <span className="font-mono text-[13px]">{localBranchName}</span> on this task.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Next step</p>
              {hasPublishTarget ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  Push{" "}
                  <span className="font-mono text-[13px] text-foreground">
                    {publishTargetLabel}
                  </span>{" "}
                  to publish the merged target branch, then move the task to Done and clean up the
                  builder workspace.
                </p>
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">
                  Move the task to Done and clean up the builder workspace. The merge is already
                  applied locally on{" "}
                  <span className="font-mono text-[13px] text-foreground">{localBranchName}</span>.
                </p>
              )}
            </div>

            <div
              className={cn(
                "mt-4 grid gap-3",
                hasPublishTarget &&
                  "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center",
              )}
            >
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className={sectionLabelClass}>Local Branch</p>
                <p className="mt-2 font-mono text-sm text-foreground">{localBranchName}</p>
              </div>

              {hasPublishTarget ? (
                <>
                  <div className="hidden justify-center md:flex">
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>

                  <div className="rounded-xl border border-border bg-muted/40 p-4">
                    <p className={sectionLabelClass}>Remote To Update</p>
                    <p className="mt-2 font-mono text-sm text-foreground">{publishTargetLabel}</p>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TaskApprovalModalFooter({ model }: { model: TaskApprovalModalModel }): ReactElement {
  const isCompletionStage = model.stage === "complete_direct_merge";
  const footerClassName = cn(
    "mt-0 border-t border-border/80 bg-muted/20 px-6 py-4 sm:px-8",
    isCompletionStage
      ? "flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      : "flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between",
  );

  if (model.stage === "complete_direct_merge") {
    const completionContextError = getDirectMergeCompletionContextError(model);
    const completionActionDisabled = model.isSubmitting || completionContextError !== null;
    const finishLaterDisabled = model.isSubmitting;
    const publishTargetBranchName = model.publishTarget?.branch ?? "";
    let completionButtonLabel = "Mark Task Done";
    if (model.isSubmitting && model.publishTarget) {
      completionButtonLabel = `Publishing ${publishTargetBranchName}`;
    } else if (model.isSubmitting) {
      completionButtonLabel = "Completing Direct Merge";
    } else if (model.publishTarget) {
      completionButtonLabel = `Push ${publishTargetBranchName} And Mark Done`;
    }
    const completionStageDescription = model.publishTarget
      ? "Finish later to keep the task in Human Review while the local merge stays ready to publish."
      : "Finish later to keep the task in Human Review until you are ready to close it and clean up the builder workspace.";

    return (
      <DialogFooter className={footerClassName}>
        <p className="text-sm text-muted-foreground">{completionStageDescription}</p>

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={finishLaterDisabled}
            onClick={model.onSkipDirectMergeCompletion}
          >
            Finish Later
          </Button>
          <Button
            type="button"
            disabled={completionActionDisabled}
            onClick={model.onCompleteDirectMerge}
          >
            {model.isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {completionButtonLabel}
          </Button>
        </div>
      </DialogFooter>
    );
  }

  if (model.stage === "missing_builder_worktree") {
    return (
      <DialogFooter className="mt-0 flex-col-reverse gap-3 border-t border-border/80 bg-muted/20 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Button
          type="button"
          variant="outline"
          disabled={model.isSubmitting}
          onClick={() => model.onOpenChange(false)}
        >
          Cancel
        </Button>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={model.isSubmitting}
            onClick={model.onResetMissingBuilderWorktree}
          >
            Reset Implementation
          </Button>
          <Button
            type="button"
            disabled={model.isSubmitting}
            onClick={model.onCompleteMissingBuilderWorktree}
          >
            {model.isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {model.isSubmitting ? "Completing Task" : "Complete Task"}
          </Button>
        </div>
      </DialogFooter>
    );
  }

  const { confirmDisabled, confirmLabel } = getApprovalSubmitValidation(model);

  return (
    <DialogFooter className={footerClassName}>
      <Button
        type="button"
        variant="outline"
        disabled={model.isSubmitting}
        onClick={() => model.onOpenChange(false)}
      >
        Cancel
      </Button>
      <Button type="button" disabled={confirmDisabled} onClick={model.onConfirm}>
        {model.isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {confirmLabel}
      </Button>
    </DialogFooter>
  );
}
