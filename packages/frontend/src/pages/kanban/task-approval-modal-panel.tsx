import { AlertTriangle, ArrowRight, Check, LoaderCircle } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { canonicalTargetBranch } from "@openducktor/frontend-core/lib/target-branch";
import { cn } from "@/lib/utils";
import type {
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMissingBuilderWorktreeModalModel,
  TaskApprovalModalModel,
} from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import {
  directMergeCompletionButtonLabel,
  directMergeCompletionStageDescription,
  getDirectMergeCompletionContextError,
  getTaskApprovalSubmitState,
  missingBuilderWorktreeConfirmLabel,
  TASK_APPROVAL_COPY,
  TASK_APPROVAL_MERGE_METHOD_OPTIONS,
  TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS,
  type TaskApprovalTextWithCode,
  taskApprovalCompletionNextStepText,
  taskApprovalLocalMergeReadyText,
  taskApprovalModeOptions,
  taskApprovalPublicationCommitLabel,
  taskApprovalPullRequestUnavailableMessage,
  taskApprovalSquashCommitHint,
  taskApprovalUncommittedChangesMessage,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import { getTaskApprovalModalHeader } from "@openducktor/frontend-core/tasks/approval/task-approval-modal-header";

const openExistingPullRequestUrl = (url: string): void => {
  void openExternalUrl(url).catch((error) => {
    toast.error("Failed to open pull request", {
      description: errorMessage(error),
    });
  });
};

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
    <SegmentedControlRoot size="lg" className="w-full" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <SegmentedControlItem
            key={option.value}
            active={isActive}
            size="lg"
            role="tab"
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </SegmentedControlItem>
        );
      })}
    </SegmentedControlRoot>
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
        "group grid min-h-36 cursor-pointer gap-2 rounded-2xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

      <DialogBody className="min-h-0 overflow-y-auto">
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

function TextWithCode({
  text,
  codeClassName,
}: {
  text: TaskApprovalTextWithCode;
  codeClassName: string;
}): ReactElement {
  return (
    <>
      {text.before}
      <span className={codeClassName}>{text.code}</span>
      {text.after}
    </>
  );
}

function TaskApprovalApprovalStage({
  model,
  sectionLabelClass,
}: {
  model: TaskApprovalApprovalModalModel;
  sectionLabelClass: string;
}): ReactElement {
  const { showSquashCommitMessageValidationError } = getTaskApprovalSubmitState(model);
  const actionOptions = taskApprovalModeOptions(model);
  const dirtyWorktreeMessage = taskApprovalUncommittedChangesMessage(model.uncommittedFileCount);

  if (model.isLoading) {
    return (
      <div className="space-y-6 px-6 py-6 sm:px-8">
        <div className="flex min-h-56 items-center justify-center rounded-2xl border border-border bg-muted/30 px-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <LoaderCircle className="size-6 animate-spin text-status-running" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {TASK_APPROVAL_COPY.loadingTitle}
              </p>
              <p className="text-sm text-muted-foreground">
                {TASK_APPROVAL_COPY.loadingDescription}
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
          <p className="text-sm font-semibold">{TASK_APPROVAL_COPY.uncommittedChangesTitle}</p>
          <p className="text-sm">{dirtyWorktreeMessage}</p>
        </div>
      ) : null}

      {model.errorMessage ? (
        <div className="grid gap-1 rounded-2xl border border-destructive-border bg-destructive-surface p-4 text-destructive-surface-foreground">
          <p className="text-sm font-semibold">{TASK_APPROVAL_COPY.approvalFailedTitle}</p>
          <p className="text-sm text-destructive-muted">{model.errorMessage}</p>
        </div>
      ) : null}

      <div className="space-y-3">
        <Label className={sectionLabelClass}>{TASK_APPROVAL_COPY.approvalActionLabel}</Label>
        <SegmentedTabs
          ariaLabel={TASK_APPROVAL_COPY.approvalActionAccessibilityLabel}
          value={model.mode}
          options={actionOptions}
          disabled={model.isSubmitting}
          onChange={model.onModeChange}
        />
        {!model.pullRequestAvailable && model.pullRequestUnavailableReason ? (
          <p className="text-sm text-muted-foreground">
            {taskApprovalPullRequestUnavailableMessage(model.pullRequestUnavailableReason)}
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
              {TASK_APPROVAL_COPY.missingWorktreeTitle}
            </p>
            <p className="text-sm leading-6 text-warning-surface-foreground">
              {TASK_APPROVAL_COPY.missingWorktreeDescription}
            </p>
          </div>
        </div>
      </div>

      {model.errorMessage ? (
        <div className="grid gap-1 rounded-2xl border border-destructive-border bg-destructive-surface p-4 text-destructive-surface-foreground">
          <p className="text-sm font-semibold">{TASK_APPROVAL_COPY.recoveryFailedTitle}</p>
          <p className="text-sm text-destructive-muted">{model.errorMessage}</p>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-foreground">
            {TASK_APPROVAL_COPY.nextStepChoiceTitle}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {TASK_APPROVAL_COPY.nextStepChoiceDescription}
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
      <Label className={sectionLabelClass}>{TASK_APPROVAL_COPY.mergeMethodLabel}</Label>
      <div className="grid gap-3 md:grid-cols-3">
        {TASK_APPROVAL_MERGE_METHOD_OPTIONS.map((option) => (
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
          <Label htmlFor="task-approval-squash-commit-message">
            {TASK_APPROVAL_COPY.squashCommitMessageLabel}
          </Label>
          <Textarea
            id="task-approval-squash-commit-message"
            className="min-h-28"
            placeholder={TASK_APPROVAL_COPY.squashCommitMessagePlaceholder}
            value={model.squashCommitMessage}
            disabled={model.isSubmitting}
            onChange={(event) => model.onSquashCommitMessageChange(event.currentTarget.value)}
          />
          <p className="text-sm text-muted-foreground">
            <TextWithCode
              text={taskApprovalSquashCommitHint(model.targetBranch)}
              codeClassName="font-mono text-[13px] text-foreground"
            />
          </p>
          {showSquashCommitMessageValidationError ? (
            <p className="text-sm text-destructive">
              {TASK_APPROVAL_COPY.squashCommitMessageRequired}
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
  const openExistingPullRequest = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    if (model.pullRequestUrl) {
      openExistingPullRequestUrl(model.pullRequestUrl);
    }
  };
  const openExistingPullRequestFromAuxiliaryClick = (
    event: MouseEvent<HTMLAnchorElement>,
  ): void => {
    event.preventDefault();
    if (event.button === 1 && model.pullRequestUrl) {
      openExistingPullRequestUrl(model.pullRequestUrl);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Label className={sectionLabelClass}>{TASK_APPROVAL_COPY.pullRequestDraftLabel}</Label>
        <div className="grid gap-3 md:grid-cols-2">
          {TASK_APPROVAL_PULL_REQUEST_DRAFT_OPTIONS.map((option) => (
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
            <Label htmlFor="task-approval-pr-title">
              {TASK_APPROVAL_COPY.pullRequestTitleLabel}
            </Label>
            <Input
              id="task-approval-pr-title"
              value={model.title}
              disabled={model.isSubmitting}
              onChange={(event) => model.onTitleChange(event.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-approval-pr-body">
              {TASK_APPROVAL_COPY.pullRequestDescriptionLabel}
            </Label>
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
          {TASK_APPROVAL_COPY.generatePullRequestNotice}
        </div>
      )}

      {model.pullRequestUrl ? (
        <a
          href={model.pullRequestUrl}
          onClick={openExistingPullRequest}
          onAuxClick={openExistingPullRequestFromAuxiliaryClick}
          onContextMenu={(event) => event.preventDefault()}
          className="text-sm text-primary underline underline-offset-4"
        >
          {TASK_APPROVAL_COPY.openExistingPullRequest}
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
          <p className="text-sm font-semibold">{TASK_APPROVAL_COPY.completionFailedTitle}</p>
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
                  {TASK_APPROVAL_COPY.localMergeReadyTitle}
                </p>
                <p className="text-sm leading-6 text-info-surface-foreground">
                  <TextWithCode
                    text={taskApprovalLocalMergeReadyText(localBranchName)}
                    codeClassName="font-mono text-[13px]"
                  />
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {TASK_APPROVAL_COPY.nextStepTitle}
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                <TextWithCode
                  text={taskApprovalCompletionNextStepText(model)}
                  codeClassName="font-mono text-[13px] text-foreground"
                />
              </p>
            </div>

            <div
              className={cn(
                "mt-4 grid gap-3",
                hasPublishTarget &&
                  "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center",
              )}
            >
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className={sectionLabelClass}>{TASK_APPROVAL_COPY.localBranchLabel}</p>
                <p className="mt-2 font-mono text-sm text-foreground">{localBranchName}</p>
              </div>

              {hasPublishTarget ? (
                <>
                  <div className="hidden justify-center md:flex">
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>

                  <div className="rounded-xl border border-border bg-muted/40 p-4">
                    <p className={sectionLabelClass}>{TASK_APPROVAL_COPY.remoteToUpdateLabel}</p>
                    <p className="mt-2 font-mono text-sm text-foreground">{publishTargetLabel}</p>
                    {model.publicationPreview ? (
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <p>
                          {taskApprovalPublicationCommitLabel(model.publicationPreview.sourceOid)}
                        </p>
                        {model.publicationPreview.destinations.map((destination) => (
                          <p key={destination.identity} className="break-all">
                            {destination.label}
                          </p>
                        ))}
                      </div>
                    ) : null}
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
  if (model.stage === "complete_direct_merge") {
    return <DirectMergeCompletionFooter model={model} />;
  }
  if (model.stage === "missing_builder_worktree") {
    return <MissingBuilderWorktreeFooter model={model} />;
  }
  return <ApprovalActionsFooter model={model} />;
}

function DirectMergeCompletionFooter({
  model,
}: {
  model: TaskApprovalCompletionModalModel;
}): ReactElement {
  const completionContextError = getDirectMergeCompletionContextError(model);
  const completionActionDisabled = model.isSubmitting || completionContextError !== null;
  const completionButtonLabel = directMergeCompletionButtonLabel(model);
  const completionStageDescription = directMergeCompletionStageDescription(model);

  return (
    <DialogFooter className="mt-0 flex-col gap-3 border-t border-border/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <p className="text-sm text-muted-foreground">{completionStageDescription}</p>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={model.isSubmitting}
          onClick={model.onSkipDirectMergeCompletion}
        >
          {TASK_APPROVAL_COPY.finishLater}
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

function MissingBuilderWorktreeFooter({
  model,
}: {
  model: TaskApprovalMissingBuilderWorktreeModalModel;
}): ReactElement {
  return (
    <DialogFooter className="mt-0 flex-col-reverse gap-3 border-t border-border/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <Button
        type="button"
        variant="outline"
        disabled={model.isSubmitting}
        onClick={() => model.onOpenChange(false)}
      >
        {TASK_APPROVAL_COPY.cancel}
      </Button>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={model.isSubmitting}
          onClick={model.onResetMissingBuilderWorktree}
        >
          {TASK_APPROVAL_COPY.resetImplementation}
        </Button>
        <Button
          type="button"
          disabled={model.isSubmitting}
          onClick={model.onCompleteMissingBuilderWorktree}
        >
          {model.isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {missingBuilderWorktreeConfirmLabel(model.isSubmitting)}
        </Button>
      </div>
    </DialogFooter>
  );
}

function ApprovalActionsFooter({ model }: { model: TaskApprovalApprovalModalModel }): ReactElement {
  const { confirmDisabled, confirmLabel } = getTaskApprovalSubmitState(model);

  return (
    <DialogFooter className="mt-0 flex-col-reverse gap-3 border-t border-border/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <Button
        type="button"
        variant="outline"
        disabled={model.isSubmitting}
        onClick={() => model.onOpenChange(false)}
      >
        {TASK_APPROVAL_COPY.cancel}
      </Button>
      <Button type="button" disabled={confirmDisabled} onClick={model.onConfirm}>
        {model.isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {confirmLabel}
      </Button>
    </DialogFooter>
  );
}
