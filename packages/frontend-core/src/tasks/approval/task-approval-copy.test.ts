import { describe, expect, test } from "bun:test";
import {
  directMergeCompletionButtonLabel,
  directMergeCompletionStageDescription,
  getDirectMergeCompletionContextError,
  getTaskApprovalSubmitState,
  missingBuilderWorktreeConfirmLabel,
  taskApprovalCompletionNextStepText,
  taskApprovalModeOptions,
  taskApprovalSquashCommitHint,
  taskApprovalUncommittedChangesMessage,
} from "./task-approval-copy";
import type { TaskApprovalApprovalModalModel } from "./task-approval-types";

const noop = (): void => {};

const approvalModel = (
  overrides: Partial<TaskApprovalApprovalModalModel> = {},
): TaskApprovalApprovalModalModel => ({
  open: true,
  taskId: "TASK-1",
  isSubmitting: false,
  errorMessage: null,
  errorOutcomeUnknown: false,
  onOpenChange: noop,
  stage: "approval",
  isLoading: false,
  mode: "direct_merge",
  mergeMethod: "merge_commit",
  pullRequestDraftMode: "manual",
  pullRequestSupported: true,
  pullRequestAvailable: true,
  pullRequestUnavailableReason: null,
  hasUncommittedChanges: false,
  uncommittedFileCount: 0,
  pullRequestUrl: null,
  title: "Ship it",
  body: "Body",
  squashCommitMessage: "feat: ship it",
  squashCommitMessageTouched: false,
  hasSuggestedSquashCommitMessage: true,
  targetBranch: { remote: "origin", branch: "main" },
  onModeChange: noop,
  onMergeMethodChange: noop,
  onPullRequestDraftModeChange: noop,
  onTitleChange: noop,
  onBodyChange: noop,
  onSquashCommitMessageChange: noop,
  onConfirm: noop,
  ...overrides,
});

describe("taskApprovalModeOptions", () => {
  test("hides Pull Request without provider support and disables it while unavailable", () => {
    expect(
      taskApprovalModeOptions({ pullRequestSupported: false, pullRequestAvailable: false }),
    ).toEqual([{ value: "direct_merge", label: "Direct Merge", disabled: false }]);
    expect(
      taskApprovalModeOptions({ pullRequestSupported: true, pullRequestAvailable: false }),
    ).toEqual([
      { value: "direct_merge", label: "Direct Merge", disabled: false },
      { value: "pull_request", label: "Pull Request", disabled: true },
    ]);
  });
});

describe("getTaskApprovalSubmitState", () => {
  test("labels the confirm control by mode and draft mode", () => {
    expect(getTaskApprovalSubmitState(approvalModel()).confirmLabel).toBe("Merge Locally");
    expect(getTaskApprovalSubmitState(approvalModel({ mode: "pull_request" })).confirmLabel).toBe(
      "Create Pull Request",
    );
    expect(
      getTaskApprovalSubmitState(
        approvalModel({ mode: "pull_request", pullRequestDraftMode: "generate_ai" }),
      ).confirmLabel,
    ).toBe("Start PR Generation");
  });

  test("blocks the submit for uncommitted changes, missing text, and an unavailable provider", () => {
    expect(getTaskApprovalSubmitState(approvalModel()).confirmDisabled).toBe(false);
    expect(
      getTaskApprovalSubmitState(approvalModel({ hasUncommittedChanges: true })).confirmDisabled,
    ).toBe(true);
    expect(
      getTaskApprovalSubmitState(approvalModel({ mode: "pull_request", title: " " }))
        .confirmDisabled,
    ).toBe(true);
    expect(
      getTaskApprovalSubmitState(
        approvalModel({ mode: "pull_request", pullRequestAvailable: false }),
      ).confirmDisabled,
    ).toBe(true);
    const squash = getTaskApprovalSubmitState(
      approvalModel({ mergeMethod: "squash", squashCommitMessage: "" }),
    );
    expect(squash.confirmDisabled).toBe(true);
    expect(squash.showSquashCommitMessageValidationError).toBe(true);
  });
});

describe("approval texts", () => {
  test("counts uncommitted files", () => {
    expect(taskApprovalUncommittedChangesMessage(1)).toBe(
      "The builder worktree has 1 uncommitted file. Commit or discard it before approving this task.",
    );
    expect(taskApprovalUncommittedChangesMessage(3)).toBe(
      "The builder worktree has 3 uncommitted files. Commit or discard them before approving this task.",
    );
  });

  test("names the squash target branch", () => {
    expect(taskApprovalSquashCommitHint(null).code).toBe("the target branch");
    expect(taskApprovalSquashCommitHint({ remote: "origin", branch: "beta" }).code).toBe("beta");
  });

  test("describes direct merge completion with and without a publish target", () => {
    const local = { targetBranch: { remote: "origin", branch: "main" }, publishTarget: null };
    const publish = { ...local, publishTarget: { remote: "origin", branch: "main" } };
    expect(taskApprovalCompletionNextStepText(local).code).toBe("main");
    expect(taskApprovalCompletionNextStepText(publish)).toEqual({
      before: "Push ",
      code: "origin/main",
      after:
        " to publish the merged target branch, then move the task to Done and clean up the builder workspace.",
    });
    expect(directMergeCompletionButtonLabel({ isSubmitting: false, publishTarget: null })).toBe(
      "Mark Task Done",
    );
    expect(
      directMergeCompletionButtonLabel({
        isSubmitting: false,
        publishTarget: publish.publishTarget,
      }),
    ).toBe("Push main And Mark Done");
    expect(
      directMergeCompletionButtonLabel({
        isSubmitting: true,
        publishTarget: publish.publishTarget,
      }),
    ).toBe("Publishing main");
    expect(directMergeCompletionButtonLabel({ isSubmitting: true, publishTarget: null })).toBe(
      "Completing Direct Merge",
    );
    expect(directMergeCompletionStageDescription({ publishTarget: null })).toContain(
      "until you are ready to close it",
    );
  });

  test("reports missing completion context", () => {
    expect(
      getDirectMergeCompletionContextError({
        targetBranch: null,
        publishTarget: null,
        publicationPreview: null,
      }),
    ).toBe(
      "Missing target branch for direct-merge completion. Refresh approval context and retry.",
    );
    expect(
      getDirectMergeCompletionContextError({
        targetBranch: { remote: "origin", branch: "main" },
        publishTarget: { remote: "origin", branch: "main" },
        publicationPreview: null,
      }),
    ).toBe("Missing publication destinations. Refresh approval context before publishing.");
    expect(missingBuilderWorktreeConfirmLabel(true)).toBe("Completing Task");
  });
});
