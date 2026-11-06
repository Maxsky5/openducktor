import { workspaceRefFixture } from "@openducktor/frontend-core/test-support/workspace-ref-fixture";
import { taskWorktreeOwnersQueryOptions } from "@openducktor/frontend-core/queries/task-worktree-owners";
import { noTaskWorktreeOwners } from "@openducktor/frontend-core/test-support/worktree-owners-read";
import { describe, expect, mock, spyOn, test } from "bun:test";
import type { TaskMergeStatus } from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, type ComponentProps, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { taskMergeStatusQueryOptions } from "@openducktor/frontend-core/queries/task-merge-status";
import { taskStopImpactQueryOptions } from "@openducktor/frontend-core/queries/task-stop-impact";
import { taskWorktreeCleanupImpactQueryOptions } from "@openducktor/frontend-core/queries/task-worktree-cleanup-impact";
import { terminalListByFilterQueryOptions } from "@openducktor/frontend-core/queries/terminals";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import * as externalUrl from "@/lib/open-external-url";
import { QueryProvider } from "@/test-utils/query-provider";
import { WorkspaceProviders } from "@/test-utils/workspace-providers";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type {
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMissingWorktreeModalModel,
} from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import { TaskApprovalModal } from "./task-approval-modal";
import { TaskApprovalModalPanel } from "./task-approval-modal-panel";

const noop = () => {};

const markupButton = (html: string, label: string): HTMLButtonElement => {
  const container = document.createElement("div");
  container.innerHTML = html;
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!button) throw new Error(`The markup has no button named ${label}.`);
  return button;
};

const LOADED_IMPACT = {
  worktreePaths: ["/worktrees/TASK-1"],
  branchNames: ["odt/TASK-1"],
  uncommittedFileCount: 0,
  mergeCandidate: false,
  branchOid: "tip",
};

/**
 * A connection whose cache holds every read of the modal, so the panel shows its content in its
 * first render, also in static markup.
 */
const createLoadedConnection = () => {
  const connection = createTestClientConnection({
    client: {
      workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
      taskWorktreeCleanupImpactGet: async () => LOADED_IMPACT,
      terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
      taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
      taskMergeStatusGet: async (scope) => ({ ...scope, tasks: [], autoCloseFailures: [] }),
    },
  });
  const { queryClient } = connection;
  const target = { workspaceId: "workspace-1", repoPath: "/repo", taskId: "TASK-1" };
  queryClient.setQueryData(taskWorktreeCleanupImpactQueryOptions(target).queryKey, LOADED_IMPACT);
  queryClient.setQueryData(
    terminalListByFilterQueryOptions({ filter: { kind: "task", ...target } }).queryKey,
    { hostInstanceId: "host", revision: 1, terminals: [] },
  );
  queryClient.setQueryData(
    taskWorktreeOwnersQueryOptions({
      workspaceId: "workspace-1",
      repoPath: "/repo",
      taskIds: ["TASK-1"],
      operation: "close",
    }).queryKey,
    noTaskWorktreeOwners,
  );
  queryClient.setQueryData(
    taskStopImpactQueryOptions({
      workspaceId: "workspace-1",
      repoPath: "/repo",
      taskIds: ["TASK-1"],
      operation: "close",
    }).queryKey,
    { stoppableSessionCount: 0 },
  );
  queryClient.setQueryData(taskMergeStatusQueryOptions(workspaceRefFixture("/repo")).queryKey, {
    workspaceId: "workspace-1",
    repoPath: "/repo",
    autoCloseFailures: [],
    tasks: [],
  });
  queryClient.setQueryData(
    settingsSnapshotQueryOptions().queryKey,
    createSettingsSnapshotFixture(),
  );
  return connection;
};

const withProviders = (element: ReactElement): ReactElement =>
  createElement(
    QueryProvider,
    { connection: createLoadedConnection() },
    createElement(WorkspaceProviders, null, element),
  );

/** The panel reads the close impact, so it needs the query and workspace providers. */
const PanelWithProviders = (props: ComponentProps<typeof TaskApprovalModalPanel>): ReactElement =>
  withProviders(createElement(TaskApprovalModalPanel, props));

const ModalWithProviders = (props: ComponentProps<typeof TaskApprovalModal>): ReactElement =>
  withProviders(createElement(TaskApprovalModal, props));

const createCompletionModel = (
  overrides: Partial<TaskApprovalCompletionModalModel> = {},
): TaskApprovalCompletionModalModel => ({
  open: true,
  stage: "complete_direct_merge",
  publicationPreview: {
    sourceOid: "a".repeat(40),
    remote: "origin",
    targetRef: "refs/heads/beta",
    destinations: [{ identity: "destination", label: "/reviewed.git" }],
  },
  taskId: "TASK-1",
  targetBranch: { remote: "origin", branch: "beta" },
  publishTarget: { remote: "origin", branch: "beta" },
  isSubmitting: false,
  errorMessage: null,
  errorOutcomeUnknown: false,
  taskTitle: "Task",
  removeWorktree: true,
  onRemoveWorktreeChange: noop,
  onOpenChange: noop,
  onSkipDirectMergeCompletion: noop,
  onCompleteDirectMerge: noop,
  ...overrides,
});

const createApprovalModel = (
  overrides: Partial<TaskApprovalApprovalModalModel> = {},
): TaskApprovalApprovalModalModel => ({
  open: true,
  stage: "approval",
  taskId: "TASK-1",
  isLoading: false,
  mode: "direct_merge",
  mergeMethod: "merge_commit",
  pullRequestDraftMode: "manual",
  pullRequestRoleLabel: "Builder",
  pullRequestSupported: true,
  pullRequestAvailable: true,
  pullRequestUnavailableReason: null,
  approvalContextError: null,
  hasUncommittedChanges: false,
  uncommittedFileCount: 0,
  pullRequestUrl: null,
  title: "Ship direct merge flow",
  body: "Task description",
  squashCommitMessage: "feat: add Microsoft login",
  squashCommitMessageTouched: false,
  hasSuggestedSquashCommitMessage: true,
  targetBranch: { remote: "origin", branch: "beta" },
  isSubmitting: false,
  errorMessage: null,
  errorOutcomeUnknown: false,
  taskTitle: "Task",
  removeWorktree: true,
  onRemoveWorktreeChange: noop,
  onOpenChange: noop,
  onModeChange: noop,
  onMergeMethodChange: noop,
  onPullRequestDraftModeChange: noop,
  onTitleChange: noop,
  onBodyChange: noop,
  onSquashCommitMessageChange: noop,
  onConfirm: noop,
  ...overrides,
});

const createMissingWorktreeModel = (
  overrides: Partial<TaskApprovalMissingWorktreeModalModel> = {},
): TaskApprovalMissingWorktreeModalModel => ({
  open: true,
  stage: "missing_worktree",
  resetLabel: "Reset Implementation",
  taskId: "TASK-1",
  isSubmitting: false,
  errorMessage: null,
  errorOutcomeUnknown: false,
  taskTitle: "Task",
  removeWorktree: true,
  onRemoveWorktreeChange: noop,
  onOpenChange: noop,
  onCloseMissingWorktree: noop,
  onResetMissingWorktree: noop,
  ...overrides,
});

describe("TaskApprovalModal", () => {
  test("renders the wrapper dialog title and description", () => {
    const rendered = render(createElement(ModalWithProviders, { model: createCompletionModel() }));

    expect(screen.getByText("Publish and mark done")).toBeTruthy();
    expect(
      screen.getByText(
        "The local merge is already applied. Push origin/beta to publish it, then move the task to Done.",
      ),
    ).toBeTruthy();

    rendered.unmount();
  });

  test("names the task in the header, with the stage note only when the stage needs one", () => {
    const approval = render(
      createElement(ModalWithProviders, { model: createApprovalModel({ taskTitle: "Add login" }) }),
    );
    expect(screen.getByText("Approve task")).toBeTruthy();
    expect(screen.getByText("Add login")).toBeTruthy();
    expect(screen.getByText("TASK-1")).toBeTruthy();
    expect(screen.queryByText(/open a pull request, or close the task/)).toBeNull();
    approval.unmount();

    const missingBuilder = render(
      createElement(ModalWithProviders, { model: createMissingWorktreeModel() }),
    );
    expect(screen.getByText("Task worktree missing")).toBeTruthy();
    expect(screen.getByText(/use Reset Implementation to start the work again/)).toBeTruthy();
    missingBuilder.unmount();
  });

  test("renders explicit completion copy for merged local branches", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, { model: createCompletionModel() }),
    );

    expect(html).toContain("Next step");
    expect(html).toContain("Push beta and mark done");
    expect(html).toContain("Finish later to keep the task in Human Review");
  });

  test("shows a loading label while direct merge completion is pending", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createCompletionModel({ isSubmitting: true }),
      }),
    );

    expect(html).toContain("Pushing beta");
    expect(html).toContain("animate-spin");
  });

  test("keeps the approval form visible when reads refresh during submission", () => {
    const view = renderWithImpact(
      createApprovalModel({ isSubmitting: true }),
      () => new Promise(() => {}),
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Merge locally" }).hasAttribute("disabled")).toBe(
      true,
    );
    view.unmount();
  });

  test("renders recovery copy when the task worktree is missing", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createMissingWorktreeModel(),
      }),
    );

    // The reset control uses the label of the workflow action that resets the worktree.
    expect(html).toContain("Reset Implementation</button>");
    // Close task replaces Complete Task and shows the shared close content.
    expect(html).toContain("Close task");
    expect(html).not.toContain("Complete Task");
    expect(html).toContain("Remove worktree and branch");
  });

  test("hides the reset control when the workflow has no worktree reset action", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createMissingWorktreeModel({ resetLabel: null }),
      }),
    );

    expect(html).not.toContain("Reset Implementation");
    expect(html).toContain("Close task");
  });

  test("shows the shared close content with Close task selected", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ mode: "close_task", hasUncommittedChanges: true }),
      }),
    );

    expect(html).toContain("Closing does not merge code or change a pull request.");
    expect(html).toContain("Remove worktree and branch");
    // Uncommitted changes do not block a close, so their merge warning does not show.
    expect(html).not.toContain(">Uncommitted changes<");
    expect(html).toContain(">Close task</button>");
  });

  test("keeps Close task when the approval context read failed", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({
          mode: "close_task",
          approvalContextError: "The task worktree has a detached HEAD.",
        }),
      }),
    );

    expect(html).toContain("Merge and pull request options are unavailable");
    expect(html).toContain("The task worktree has a detached HEAD.");
    expect(markupButton(html, "Direct merge").disabled).toBe(true);
    expect(html).toContain(">Close task</button>");
  });

  const renderWithImpact = (
    model: TaskApprovalApprovalModalModel | TaskApprovalCompletionModalModel,
    readImpact: () => Promise<{
      worktreePaths: string[];
      branchNames: string[];
      uncommittedFileCount: number;
      mergeCandidate: boolean;
      branchOid: string | null;
    }>,
  ) => {
    const connection = createTestClientConnection({
      client: {
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: readImpact,
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
        taskMergeStatusGet: async (scope) => ({ ...scope, tasks: [], autoCloseFailures: [] }),
      },
    });
    return render(
      createElement(
        QueryProvider,
        { connection },
        createElement(WorkspaceProviders, null, createElement(TaskApprovalModalPanel, { model })),
      ),
    );
  };
  const readKeptWorktree = async () => ({
    worktreePaths: ["/worktrees/TASK-1"],
    branchNames: ["odt/TASK-1"],
    uncommittedFileCount: 0,
    mergeCandidate: true,
    branchOid: "tip",
  });
  const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

  test("names the worktree that a direct merge keeps before Merge locally works", async () => {
    const view = renderWithImpact(
      createApprovalModel({ mode: "direct_merge", removeWorktree: false }),
      readKeptWorktree,
    );

    try {
      // The one loader shows until every read of the modal ends.
      expect(screen.getByRole("status")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Merge locally" })).toBeNull();
      await screen.findByRole("button", { name: "Merge locally" });
      expect(screen.getByRole("button", { name: "Worktree details" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Worktree details" }));
      expect(screen.getByText("/worktrees/TASK-1")).toBeTruthy();
      expect(screen.getByText("odt/TASK-1")).toBeTruthy();
      expect(
        screen
          .getByRole("switch", { name: "Remove worktree and branch" })
          .getAttribute("aria-checked"),
      ).toBe("false");
      expect(button("Merge locally").disabled).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test.each([
    ["Direct merge", createApprovalModel({ mode: "direct_merge" }), "Merge locally"],
    ["Complete Direct merge", createCompletionModel(), "Push beta and mark done"],
  ] as const)(
    "keeps %s disabled while the cleanup read is pending or failed",
    async (_stage, model, confirmLabel) => {
      const pending = renderWithImpact(model, () => new Promise(() => {}));
      try {
        expect(screen.getByRole("status")).toBeTruthy();
        expect(screen.queryByRole("button", { name: confirmLabel })).toBeNull();
      } finally {
        pending.unmount();
      }

      let failRead = true;
      const failed = renderWithImpact(model, async () => {
        if (failRead) throw new Error("The worktree is not readable.");
        return readKeptWorktree();
      });
      try {
        await screen.findByRole("button", { name: "Retry" });
        expect(screen.getByText("The worktree is not readable.")).toBeTruthy();
        expect(button(confirmLabel).disabled).toBe(true);

        failRead = false;
        // The read settles inside act, so React applies its result before the next check.
        await act(async () => {
          fireEvent.click(button("Retry"));
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await waitFor(() => expect(button(confirmLabel).disabled).toBe(false));
        expect(screen.queryByText("The worktree is not readable.")).toBeNull();
      } finally {
        failed.unmount();
      }
    },
  );

  test("shows the close tab at once after a tab change, without a new read", async () => {
    const impactGet = mock(async () => readKeptWorktree());
    const stopImpactGet = mock(async () => ({ stoppableSessionCount: 0 }));
    const connection = createTestClientConnection({
      client: {
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: impactGet,
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
        taskStopImpactGet: stopImpactGet,
        taskMergeStatusGet: async (scope) => ({ ...scope, tasks: [], autoCloseFailures: [] }),
      },
    });
    const panel = (mode: TaskApprovalApprovalModalModel["mode"]) =>
      createElement(
        QueryProvider,
        { connection },
        createElement(
          WorkspaceProviders,
          null,
          createElement(TaskApprovalModalPanel, { model: createApprovalModel({ mode }) }),
        ),
      );
    const view = render(panel("direct_merge"));

    try {
      await screen.findByRole("button", { name: "Merge locally" });
      expect(screen.getByRole("button", { name: "Worktree details" })).toBeTruthy();
      view.rerender(panel("close_task"));

      // The close content shows in the same render, with no loader and no new read.
      expect(screen.queryByText("Loading the task")).toBeNull();
      expect(
        screen.getByText("Closing does not merge code or change a pull request."),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Worktree details" })).toBeTruthy();
      expect(impactGet).toHaveBeenCalledTimes(1);
      expect(stopImpactGet).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  test("Check again keeps the current merge status until the check ends", async () => {
    const status = (result: TaskMergeStatus["result"]): TaskMergeStatus => ({
      taskId: "TASK-1",
      branch: "odt/TASK-1",
      targetBranch: { remote: "origin", branch: "main" },
      result,
    });
    const checkedAt = "2026-10-25T10:00:00.000Z";
    const notMerged = status({
      kind: "not_merged",
      checkedAt,
      branchOid: "tip",
      unmergedCommitCount: 1,
    });
    let finishCheck: () => void = () => {};
    const connection = createTestClientConnection({
      client: {
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: async () => readKeptWorktree(),
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
        taskMergeStatusGet: async (scope) => ({
          ...scope,
          tasks: [notMerged],
          autoCloseFailures: [],
        }),
        // The check finds the same result, so the card must not change at all.
        taskMergeStatusCheck: (scope) =>
          new Promise((resolve) => {
            finishCheck = () => resolve({ ...scope, tasks: [notMerged], autoCloseFailures: [] });
          }),
      },
    });
    const view = render(
      createElement(
        QueryProvider,
        { connection },
        createElement(
          WorkspaceProviders,
          null,
          createElement(TaskApprovalModalPanel, {
            model: createApprovalModel({ mode: "close_task" }),
          }),
        ),
      ),
    );
    const notMergedText = "Not merged: 1 commit is not in origin/main.";

    try {
      expect(await screen.findByText(notMergedText)).toBeTruthy();
      fireEvent.click(await screen.findByRole("button", { name: "Check again" }));

      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: "Check again" }).disabled,
        ).toBe(true),
      );
      expect(screen.getByText(notMergedText)).toBeTruthy();
      expect(screen.queryByText("Checking the merge status.")).toBeNull();
      expect(screen.getByRole("button", { name: "Worktree details" })).toBeTruthy();

      await act(async () => {
        finishCheck();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: "Check again" }).disabled,
        ).toBe(false),
      );
      expect(screen.getByText(notMergedText)).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  test("Check again shows the check failure and enables the button again", async () => {
    const connection = createTestClientConnection({
      client: {
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: async () => ({
          worktreePaths: ["/worktrees/TASK-1"],
          branchNames: ["odt/TASK-1"],
          uncommittedFileCount: 0,
          mergeCandidate: true,
          branchOid: "tip",
        }),
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
        taskMergeStatusGet: async (scope) => ({ ...scope, tasks: [], autoCloseFailures: [] }),
        taskMergeStatusCheck: async () => {
          throw new Error("git fetch origin failed.");
        },
      },
    });
    const view = render(
      createElement(
        QueryProvider,
        { connection },
        createElement(
          WorkspaceProviders,
          null,
          createElement(TaskApprovalModalPanel, {
            model: createApprovalModel({ mode: "close_task" }),
          }),
        ),
      ),
    );

    try {
      const checkAgain = await screen.findByRole<HTMLButtonElement>("button", {
        name: "Check again",
      });
      fireEvent.click(checkAgain);

      expect(await screen.findByText("git fetch origin failed.")).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Check again" }).disabled).toBe(
        false,
      );
    } finally {
      view.unmount();
    }
  });

  test("Check again reads the branch tip again and shows the new merge result", async () => {
    let branchOid = "old-tip";
    const impactGet = mock(async () => ({
      worktreePaths: ["/worktrees/TASK-1"],
      branchNames: ["odt/TASK-1"],
      uncommittedFileCount: 0,
      mergeCandidate: true,
      branchOid,
    }));
    const status = (result: TaskMergeStatus["result"]): TaskMergeStatus => ({
      taskId: "TASK-1",
      branch: "odt/TASK-1",
      targetBranch: { remote: "origin", branch: "main" },
      result,
    });
    const checkedAt = "2026-10-25T10:00:00.000Z";
    const connection = createTestClientConnection({
      client: {
        workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        taskWorktreeOwnersGet: async () => noTaskWorktreeOwners,
        taskWorktreeCleanupImpactGet: impactGet,
        terminalList: async () => ({ hostInstanceId: "host", revision: 1, terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
        taskMergeStatusGet: async (scope) => ({
          ...scope,
          autoCloseFailures: [],
          tasks: [
            status({ kind: "not_merged", checkedAt, branchOid: "old-tip", unmergedCommitCount: 1 }),
          ],
        }),
        taskMergeStatusCheck: async (scope) => ({
          ...scope,
          autoCloseFailures: [],
          tasks: [status({ kind: "merged", checkedAt, branchOid: "new-tip" })],
        }),
      },
    });
    const view = render(
      createElement(
        QueryProvider,
        { connection },
        createElement(
          WorkspaceProviders,
          null,
          createElement(TaskApprovalModalPanel, {
            model: createApprovalModel({ mode: "close_task" }),
          }),
        ),
      ),
    );

    try {
      expect(await screen.findByText("Not merged: 1 commit is not in origin/main.")).toBeTruthy();
      // The task branch gets a new commit while the modal stays open.
      branchOid = "new-tip";
      fireEvent.click(await screen.findByRole("button", { name: "Check again" }));

      expect(await screen.findByText("Branch merged into origin/main.")).toBeTruthy();
      expect(screen.queryByText(/The task branch changed after the last check/)).toBeNull();
      expect(impactGet).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
    }
  });

  test("describes the cleanup that the direct merge completion runs", () => {
    const kept = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createCompletionModel({ removeWorktree: false }),
      }),
    );
    const removed = renderToStaticMarkup(
      createElement(PanelWithProviders, { model: createCompletionModel({ removeWorktree: true }) }),
    );

    // The cleanup card names the targets, and only the checkbox shows the choice.
    expect(kept).toContain('aria-checked="false"');
    expect(removed).toContain('aria-checked="true"');
    expect(kept).toContain("Worktree details");
    expect(removed).toContain("Worktree details");
    expect(kept).not.toContain("clean up the builder workspace");
  });

  test("shows a loading indicator for approval submission actions", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ isSubmitting: true }),
      }),
    );

    expect(html).toContain("Merge locally");
    expect(html).toContain("animate-spin");
  });

  test("uses running status color while approval options load", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ isLoading: true }),
      }),
    );

    expect(html).toContain("Loading task details…");
    expect(html).toContain("animate-spin");
    expect(html).toContain('role="status"');
  });

  test("renders the squash commit message editor when squash is selected", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ mergeMethod: "squash" }),
      }),
    );

    expect(html).toContain("Squash commit message");
    expect(html).toContain("feat: add Microsoft login");
    expect(html).toContain("combining the branch changes into one commit");
  });

  test("disables direct merge confirmation when the squash commit message is empty", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({
          mergeMethod: "squash",
          squashCommitMessage: "",
        }),
      }),
    );

    expect(html).toContain("Enter the squash commit message before merging locally.");
    expect(markupButton(html, "Merge locally").disabled).toBe(true);
  });

  test("does not show a squash validation error before the user interacts when no suggestion exists", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({
          mergeMethod: "squash",
          squashCommitMessage: "",
          squashCommitMessageTouched: false,
          hasSuggestedSquashCommitMessage: false,
        }),
      }),
    );

    expect(html).toContain('placeholder="e.g. feat: add Microsoft login"');
    expect(html).not.toContain("Enter the squash commit message before merging locally.");
    expect(markupButton(html, "Merge locally").disabled).toBe(true);
  });

  test("fails fast when direct-merge completion branch context is missing", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createCompletionModel({
          targetBranch: null,
          publishTarget: null,
        }),
      }),
    );

    expect(html).toContain("Close and reopen Approve task to load the target branch.");
    expect(html).not.toContain(">the target branch</span>");
    expect(html).not.toContain("Local merge ready");
    expect(html).toMatch(/<button[^>]*>Finish later<\/button>/);
    expect(markupButton(html, "Mark task done").disabled).toBe(true);
  });

  test("renders AI pull request copy for the forked builder workflow", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({
          mode: "pull_request",
          pullRequestDraftMode: "generate_ai",
        }),
      }),
    );

    expect(html).toContain("Ask Builder");
    expect(html).toContain("Let Builder create or update the pull request.");
    expect(html).toContain("Next, choose the Builder session to use.");
    expect(html).toContain("Choose Builder session");
    expect(html).not.toContain("generate the pull request title and description");
  });

  test("opens an existing pull request through the external URL shell bridge", () => {
    const openExternalUrlSpy = spyOn(externalUrl, "openExternalUrl").mockResolvedValue();
    const pullRequestUrl = "https://github.com/openai/openducktor/pull/42";

    try {
      const view = render(
        createElement(PanelWithProviders, {
          model: createApprovalModel({
            mode: "pull_request",
            pullRequestUrl,
          }),
        }),
      );
      const link = view.getByRole("link", { name: "Open existing pull request" });

      expect(link.getAttribute("target")).toBeNull();
      expect(fireEvent.click(link)).toBe(false);
      expect(openExternalUrlSpy).toHaveBeenCalledWith(pullRequestUrl);
      view.unmount();
    } finally {
      openExternalUrlSpy.mockRestore();
    }
  });

  test("disables pull request confirmation when the provider is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({
          mode: "pull_request",
          pullRequestAvailable: false,
          pullRequestUnavailableReason: "GitHub is not configured for this repository.",
        }),
      }),
    );

    expect(html).toContain(
      "Pull request unavailable: GitHub is not configured for this repository.",
    );
    expect(markupButton(html, "Create pull request").disabled).toBe(true);
  });

  test("hides pull request approval when the provider does not support it", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ pullRequestSupported: false }),
      }),
    );

    expect(html).not.toContain("Open Pull request");
    expect(html).toContain("Direct merge");
  });
});
