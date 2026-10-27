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
  TaskApprovalMissingBuilderWorktreeModalModel,
} from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import { TaskApprovalModal } from "./task-approval-modal";
import { TaskApprovalModalPanel } from "./task-approval-modal-panel";

const noop = () => {};

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
      taskWorktreeCleanupImpactGet: async () => LOADED_IMPACT,
      terminalList: async () => ({ hostInstanceId: "host", terminals: [] }),
      taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
      taskMergeStatusGet: async (repoPath) => ({ repoPath, tasks: [] }),
    },
  });
  const { queryClient } = connection;
  const target = { repoPath: "/repo", taskId: "TASK-1" };
  queryClient.setQueryData(taskWorktreeCleanupImpactQueryOptions(target).queryKey, LOADED_IMPACT);
  queryClient.setQueryData(
    terminalListByFilterQueryOptions({ filter: { kind: "task", ...target } }).queryKey,
    { hostInstanceId: "host", terminals: [] },
  );
  queryClient.setQueryData(
    taskStopImpactQueryOptions({ repoPath: "/repo", taskIds: ["TASK-1"], operation: "close" })
      .queryKey,
    { stoppableSessionCount: 0 },
  );
  queryClient.setQueryData(taskMergeStatusQueryOptions("/repo").queryKey, {
    repoPath: "/repo",
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

const createMissingBuilderWorktreeModel = (
  overrides: Partial<TaskApprovalMissingBuilderWorktreeModalModel> = {},
): TaskApprovalMissingBuilderWorktreeModalModel => ({
  open: true,
  stage: "missing_builder_worktree",
  taskId: "TASK-1",
  isSubmitting: false,
  errorMessage: null,
  errorOutcomeUnknown: false,
  taskTitle: "Task",
  removeWorktree: true,
  onRemoveWorktreeChange: noop,
  onOpenChange: noop,
  onCloseMissingBuilderWorktree: noop,
  onResetMissingBuilderWorktree: noop,
  ...overrides,
});

describe("TaskApprovalModal", () => {
  test("renders the wrapper dialog title and description", () => {
    const rendered = render(createElement(ModalWithProviders, { model: createCompletionModel() }));

    expect(screen.getByText("Publish And Mark Done")).toBeTruthy();
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
    expect(screen.getByText("Approve Task")).toBeTruthy();
    expect(screen.getByText("Add login")).toBeTruthy();
    expect(screen.getByText("TASK-1")).toBeTruthy();
    expect(screen.queryByText(/open a pull request, or close the task/)).toBeNull();
    approval.unmount();

    const missingBuilder = render(
      createElement(ModalWithProviders, { model: createMissingBuilderWorktreeModel() }),
    );
    expect(screen.getByText("Builder Worktree Missing")).toBeTruthy();
    expect(screen.getByText(/OpenDucktor cannot find the builder worktree/)).toBeTruthy();
    missingBuilder.unmount();
  });

  test("renders explicit completion copy for merged local branches", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, { model: createCompletionModel() }),
    );

    expect(html).toContain("Next step");
    expect(html).toContain("Push beta And Mark Done");
    expect(html).toContain("Finish later to keep the task in Human Review");
  });

  test("shows a loading label while direct merge completion is pending", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createCompletionModel({ isSubmitting: true }),
      }),
    );

    expect(html).toContain("Publishing beta");
    expect(html).toContain("animate-spin");
  });

  test("renders recovery copy when the builder worktree is missing", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createMissingBuilderWorktreeModel(),
      }),
    );

    expect(html).toContain("Reset Implementation");
    // Close Task replaces Complete Task and shows the shared close content.
    expect(html).toContain("Close Task");
    expect(html).not.toContain("Complete Task");
    expect(html).toContain("Remove worktree and branch");
  });

  test("shows the shared close content with Close Task selected", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ mode: "close_task", hasUncommittedChanges: true }),
      }),
    );

    expect(html).toContain("Close Task merges no code and changes no pull request.");
    expect(html).toContain("Remove worktree and branch");
    // Uncommitted changes do not block a close, so their merge warning does not show.
    expect(html).not.toContain(">Uncommitted changes<");
    expect(html).toContain(">Close Task</button>");
  });

  test("keeps Close Task when the approval context read failed", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({
          mode: "close_task",
          approvalContextError: "The task worktree has a detached HEAD.",
        }),
      }),
    );

    expect(html).toContain("Direct Merge and Pull Request are unavailable");
    expect(html).toContain("The task worktree has a detached HEAD.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Direct Merge<\/button>/);
    expect(html).toContain(">Close Task</button>");
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
        taskWorktreeCleanupImpactGet: readImpact,
        terminalList: async () => ({ hostInstanceId: "host", terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
        taskMergeStatusGet: async (repoPath) => ({ repoPath, tasks: [] }),
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

  test("names the worktree that a direct merge keeps before Merge Locally works", async () => {
    const view = renderWithImpact(
      createApprovalModel({ mode: "direct_merge", removeWorktree: false }),
      readKeptWorktree,
    );

    try {
      // The one loader shows until every read of the modal ends.
      expect(screen.getByText("Loading the task")).toBeTruthy();
      expect(button("Merge Locally").disabled).toBe(true);
      expect(await screen.findByText("/worktrees/TASK-1")).toBeTruthy();
      expect(screen.getByText("odt/TASK-1")).toBeTruthy();
      expect(
        screen
          .getByRole("switch", { name: "Remove worktree and branch" })
          .getAttribute("aria-checked"),
      ).toBe("false");
      expect(button("Merge Locally").disabled).toBe(false);
    } finally {
      view.unmount();
    }
  });

  test.each([
    ["Direct Merge", createApprovalModel({ mode: "direct_merge" }), "Merge Locally"],
    ["Complete Direct Merge", createCompletionModel(), "Push beta And Mark Done"],
  ] as const)(
    "keeps %s disabled while the cleanup read is pending or failed",
    async (_stage, model, confirmLabel) => {
      const pending = renderWithImpact(model, () => new Promise(() => {}));
      try {
        expect(screen.getByText("Loading the task")).toBeTruthy();
        expect(button(confirmLabel).disabled).toBe(true);
      } finally {
        pending.unmount();
      }

      let failRead = true;
      const failed = renderWithImpact(model, async () => {
        if (failRead) throw new Error("The worktree is not readable.");
        return readKeptWorktree();
      });
      try {
        expect(await screen.findByText("The worktree is not readable.")).toBeTruthy();
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
        taskWorktreeCleanupImpactGet: impactGet,
        terminalList: async () => ({ hostInstanceId: "host", terminals: [] }),
        taskStopImpactGet: stopImpactGet,
        taskMergeStatusGet: async (repoPath) => ({ repoPath, tasks: [] }),
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
      expect(await screen.findByText("/worktrees/TASK-1")).toBeTruthy();
      view.rerender(panel("close_task"));

      // The close content shows in the same render, with no loader and no new read.
      expect(screen.queryByText("Loading the task")).toBeNull();
      expect(
        screen.getByText("Close Task merges no code and changes no pull request."),
      ).toBeTruthy();
      expect(screen.getByText("/worktrees/TASK-1")).toBeTruthy();
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
        taskWorktreeCleanupImpactGet: async () => readKeptWorktree(),
        terminalList: async () => ({ hostInstanceId: "host", terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
        taskMergeStatusGet: async (repoPath) => ({ repoPath, tasks: [notMerged] }),
        // The check finds the same result, so the card must not change at all.
        taskMergeStatusCheck: (repoPath) =>
          new Promise((resolve) => {
            finishCheck = () => resolve({ repoPath, tasks: [notMerged] });
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
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));

      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>("button", { name: "Check again" }).disabled,
        ).toBe(true),
      );
      expect(screen.getByText(notMergedText)).toBeTruthy();
      expect(screen.queryByText("Checking the merge status.")).toBeNull();
      expect(screen.getByText("/worktrees/TASK-1")).toBeTruthy();

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
        taskWorktreeCleanupImpactGet: async () => ({
          worktreePaths: ["/worktrees/TASK-1"],
          branchNames: ["odt/TASK-1"],
          uncommittedFileCount: 0,
          mergeCandidate: true,
          branchOid: "tip",
        }),
        terminalList: async () => ({ hostInstanceId: "host", terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
        taskMergeStatusGet: async (repoPath) => ({ repoPath, tasks: [] }),
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
        taskWorktreeCleanupImpactGet: impactGet,
        terminalList: async () => ({ hostInstanceId: "host", terminals: [] }),
        taskStopImpactGet: async () => ({ stoppableSessionCount: 0 }),
        taskMergeStatusGet: async (repoPath) => ({
          repoPath,
          tasks: [
            status({ kind: "not_merged", checkedAt, branchOid: "old-tip", unmergedCommitCount: 1 }),
          ],
        }),
        taskMergeStatusCheck: async (repoPath) => ({
          repoPath,
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
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));

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
    expect(kept).toContain("/worktrees/TASK-1");
    expect(removed).toContain("/worktrees/TASK-1");
    expect(kept).not.toContain("clean up the builder workspace");
  });

  test("shows a loading indicator for approval submission actions", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ isSubmitting: true }),
      }),
    );

    expect(html).toContain("Merge Locally");
    expect(html).toContain("animate-spin");
  });

  test("uses running status color while approval options load", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ isLoading: true }),
      }),
    );

    expect(html).toContain("Loading the task");
    expect(html).toContain("animate-spin");
    expect(html).toContain("text-status-running");
  });

  test("renders the squash commit message editor when squash is selected", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ mergeMethod: "squash" }),
      }),
    );

    expect(html).toContain("Squash Commit Message");
    expect(html).toContain("feat: add Microsoft login");
    expect(html).toContain("oldest commit unique to the builder branch");
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Merge Locally<\/button>/);
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Merge Locally<\/button>/);
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

    expect(html).toContain(
      "Missing target branch for direct-merge completion. Refresh approval context and retry.",
    );
    expect(html).not.toContain("the target branch");
    expect(html).not.toContain("Local merge ready");
    expect(html).toMatch(/<button[^>]*>Finish Later<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Mark Task Done<\/button>/);
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

    expect(html).toContain("Generate With AI");
    expect(html).toContain(
      "Choose a Builder session to fork, then let Builder create or update the pull request automatically.",
    );
    expect(html).toContain(
      "OpenDucktor asks you to choose a Builder session to fork. That session then creates or updates the pull request.",
    );
    expect(html).toContain("Start PR Generation");
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create Pull Request<\/button>/);
  });

  test("hides pull request approval when the provider does not support it", () => {
    const html = renderToStaticMarkup(
      createElement(PanelWithProviders, {
        model: createApprovalModel({ pullRequestSupported: false }),
      }),
    );

    expect(html).not.toContain("Open Pull Request");
    expect(html).toContain("Direct Merge");
  });
});
