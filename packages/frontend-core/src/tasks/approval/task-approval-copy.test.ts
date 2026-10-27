import { describe, expect, test } from "bun:test";
import {
  directMergeCompletionButtonLabel,
  directMergeCompletionStageDescription,
  getDirectMergeCompletionContextError,
  getTaskApprovalSubmitState,
  taskApprovalCompletionNextStepText,
  taskApprovalModeOptions,
  taskApprovalSquashCommitHint,
  taskApprovalUncommittedChangesMessage,
} from "./task-approval-copy";
import type { TaskApprovalImpact, TaskWorktreeImpact } from "../details/use-task-close-impact";
import type { TaskApprovalApprovalModalModel } from "./task-approval-types";

const noop = (): void => {};

const worktreeImpact = (overrides: Partial<TaskWorktreeImpact> = {}): TaskWorktreeImpact => ({
  isLoading: false,
  isReady: true,
  error: null,
  retry: noop,
  worktreePaths: ["/worktrees/TASK-1"],
  branchNames: ["odt/TASK-1"],
  uncommittedFileCount: 0,
  terminalCount: 0,
  ...overrides,
});

const approvalImpact = (overrides: Partial<TaskWorktreeImpact> = {}): TaskApprovalImpact => ({
  worktree: worktreeImpact(overrides),
  close: {
    ...worktreeImpact(overrides),
    taskId: "TASK-1",
    taskTitle: "Ship it",
    mergeStatus: null,
    activeSessionCount: 0,
  },
});

const submitState = (
  overrides: Partial<TaskApprovalApprovalModalModel> = {},
  impact = approvalImpact(),
  isPreparing = false,
) => getTaskApprovalSubmitState(approvalModel(overrides), impact, isPreparing);

const approvalModel = (
  overrides: Partial<TaskApprovalApprovalModalModel> = {},
): TaskApprovalApprovalModalModel => ({
  open: true,
  taskId: "TASK-1",
  taskTitle: "Ship it",
  isSubmitting: false,
  errorMessage: null,
  errorOutcomeUnknown: false,
  removeWorktree: true,
  onRemoveWorktreeChange: noop,
  onOpenChange: noop,
  stage: "approval",
  isLoading: false,
  mode: "direct_merge",
  mergeMethod: "merge_commit",
  pullRequestDraftMode: "manual",
  pullRequestSupported: true,
  pullRequestAvailable: true,
  pullRequestUnavailableReason: null,
  approvalContextError: null,
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
      taskApprovalModeOptions({
        pullRequestSupported: false,
        pullRequestAvailable: false,
        approvalContextError: null,
      }),
    ).toEqual([
      { value: "direct_merge", label: "Direct Merge", disabled: false },
      { value: "close_task", label: "Close Task", disabled: false },
    ]);
    expect(
      taskApprovalModeOptions({
        pullRequestSupported: true,
        pullRequestAvailable: false,
        approvalContextError: null,
      }),
    ).toEqual([
      { value: "direct_merge", label: "Direct Merge", disabled: false },
      { value: "pull_request", label: "Pull Request", disabled: true },
      { value: "close_task", label: "Close Task", disabled: false },
    ]);
  });

  test("keeps only Close Task when the approval context read fails", () => {
    expect(
      taskApprovalModeOptions({
        pullRequestSupported: true,
        pullRequestAvailable: true,
        approvalContextError: "The task worktree is detached.",
      }),
    ).toEqual([
      { value: "direct_merge", label: "Direct Merge", disabled: true },
      { value: "pull_request", label: "Pull Request", disabled: true },
      { value: "close_task", label: "Close Task", disabled: false },
    ]);
  });
});

describe("getTaskApprovalSubmitState", () => {
  test("labels the confirm control by mode and draft mode", () => {
    expect(submitState().confirmLabel).toBe("Merge Locally");
    expect(submitState({ mode: "pull_request" }).confirmLabel).toBe("Create Pull Request");
    expect(
      submitState({ mode: "pull_request", pullRequestDraftMode: "generate_ai" }).confirmLabel,
    ).toBe("Start PR Generation");
    expect(submitState({ mode: "close_task" }).confirmLabel).toBe("Close Task");
    expect(submitState({ mode: "close_task", isSubmitting: true }).confirmLabel).toBe(
      "Closing Task",
    );
  });

  test("blocks the submit for uncommitted changes, missing text, and an unavailable provider", () => {
    expect(submitState().confirmDisabled).toBe(false);
    expect(submitState({ hasUncommittedChanges: true }).confirmDisabled).toBe(true);
    expect(submitState({ mode: "pull_request", title: " " }).confirmDisabled).toBe(true);
    expect(submitState({ mode: "pull_request", pullRequestAvailable: false }).confirmDisabled).toBe(
      true,
    );
    const squash = submitState({ mergeMethod: "squash", squashCommitMessage: "" });
    expect(squash.confirmDisabled).toBe(true);
    expect(squash.showSquashCommitMessageValidationError).toBe(true);
  });

  test("waits for the reads and the cleanup choice of a submit that closes the task", () => {
    expect(submitState({}, approvalImpact(), true).confirmDisabled).toBe(true);
    expect(submitState({ removeWorktree: null }).confirmDisabled).toBe(true);
    expect(
      submitState({}, approvalImpact({ error: "Unable to read the worktree." })).confirmDisabled,
    ).toBe(true);
    // A pull request does not close the task, so it needs no cleanup choice.
    expect(submitState({ mode: "pull_request", removeWorktree: null }).confirmDisabled).toBe(false);
  });

  test("lets Close Task run with uncommitted changes and a failed approval context read", () => {
    expect(
      submitState({
        mode: "close_task",
        hasUncommittedChanges: true,
        approvalContextError: "The task worktree is detached.",
      }).confirmDisabled,
    ).toBe(false);
    expect(
      submitState({ approvalContextError: "The task worktree is detached." }).confirmDisabled,
    ).toBe(true);
  });
});

describe("approval texts", () => {
  test("counts uncommitted files", () => {
    expect(taskApprovalUncommittedChangesMessage(1)).toBe(
      "The builder worktree has 1 uncommitted file. Commit or discard it before you merge.",
    );
    expect(taskApprovalUncommittedChangesMessage(3)).toBe(
      "The builder worktree has 3 uncommitted files. Commit or discard them before you merge.",
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
      after: " to publish the merged target branch, then move the task to Done.",
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
  });
});
