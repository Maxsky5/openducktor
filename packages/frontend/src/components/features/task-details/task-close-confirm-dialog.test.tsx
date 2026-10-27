import { describe, expect, mock, test } from "bun:test";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { QueryProvider } from "@/test-utils/query-provider";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { TaskCloseConfirmDialog } from "./task-close-confirm-dialog";
import type { TaskCloseImpact } from "@openducktor/frontend-core/tasks/details/use-task-close-impact";

enableReactActEnvironment();

const buildImpact = (overrides: Partial<TaskCloseImpact> = {}): TaskCloseImpact => ({
  taskId: "TASK-1",
  taskTitle: "Add login",
  mergeStatus: { kind: "not_merged", text: "Not merged: 2 commits are not in origin/main." },
  worktreePaths: ["/worktrees/TASK-1"],
  branchNames: ["odt/TASK-1"],
  uncommittedFileCount: 3,
  terminalCount: 2,
  activeSessionCount: 1,
  isLoading: false,
  isReady: true,
  error: null,
  retry: () => {},
  ...overrides,
});

const renderDialog = (props: Partial<Parameters<typeof TaskCloseConfirmDialog>[0]> = {}) =>
  render(
    <QueryProvider>
      <TaskCloseConfirmDialog
        open
        onOpenChange={() => {}}
        onCancel={() => {}}
        onConfirm={() => {}}
        operation={{ isPending: false, error: null, errorOutcomeUnknown: false }}
        impact={buildImpact()}
        isPreparing={false}
        removeWorktree
        onRemoveWorktreeChange={() => {}}
        confirmDisabled={false}
        {...props}
      />
    </QueryProvider>,
  );

describe("TaskCloseConfirmDialog", () => {
  test("shows one loader in place of the content until the reads end", () => {
    const { unmount } = renderDialog({ isPreparing: true, confirmDisabled: true });

    expect(screen.getByText("Add login")).toBeDefined();
    expect(screen.getByText("Loading the task")).toBeDefined();
    expect(screen.queryByText("Not merged: 2 commits are not in origin/main.")).toBeNull();
    expect(screen.queryByText("/worktrees/TASK-1")).toBeNull();

    unmount();
  });

  test("shows the merge status once and names what the cleanup removes", () => {
    const { unmount } = renderDialog();

    expect(screen.getByText("Add login")).toBeDefined();
    expect(screen.getByText("TASK-1")).toBeDefined();
    expect(screen.getByText("Not merged: 2 commits are not in origin/main.")).toBeDefined();
    // The merge status card already says that the branch is not merged.
    expect(screen.queryByText("The task branch is not detected as merged.")).toBeNull();
    expect(screen.queryByText(/Branch commits that are not in/)).toBeNull();
    expect(screen.getByText("/worktrees/TASK-1")).toBeDefined();
    expect(screen.getByText("odt/TASK-1")).toBeDefined();
    expect(screen.getByText("3 uncommitted files")).toBeDefined();
    expect(
      screen.getByText("2 task terminals, including action terminals, will be stopped."),
    ).toBeDefined();
    expect(
      screen.getByText("1 active agent session will be stopped before closing."),
    ).toBeDefined();
    expect(
      screen.getByText("Close Task merges no code and changes no pull request."),
    ).toBeDefined();
    expect(
      screen.getByText(/moves to Done with its artifacts, session history, and pull request link/),
    ).toBeDefined();

    unmount();
  });

  test("names the task in the header with a copyable ID, and does not focus the copy control", () => {
    const { unmount } = renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Close Task" });
    // The task line is the description of the dialog.
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("Add login");
    expect(screen.getByRole("button", { name: "Copy task ID" })).toBeDefined();
    expect(screen.queryByText("Move this task to Done.")).toBeNull();
    // Focus on the copy control would open its tooltip, so the dialog takes the focus.
    expect(document.activeElement).toBe(dialog);

    unmount();
  });

  test("keeps the same cleanup rows when the choice changes", () => {
    const onRemoveWorktreeChange = mock((_removeWorktree: boolean) => {});
    const cleanupText = () =>
      screen.getByRole("switch", { name: "Remove worktree and branch" }).closest(".rounded-lg")
        ?.textContent;
    const view = renderDialog({ removeWorktree: true });
    const removedText = cleanupText();
    view.unmount();

    const { unmount } = renderDialog({ removeWorktree: false, onRemoveWorktreeChange });

    // The rows do not change with the choice, so the card keeps its size.
    expect(cleanupText()).toBe(removedText);
    expect(screen.getByText("/worktrees/TASK-1")).toBeDefined();
    fireEvent.click(screen.getByRole("switch", { name: "Remove worktree and branch" }));
    expect(onRemoveWorktreeChange).toHaveBeenCalledWith(true);

    unmount();
  });

  test("shows the close in progress and its error", () => {
    const { unmount } = renderDialog({
      operation: { isPending: true, error: "Cleanup failed", errorOutcomeUnknown: false },
      confirmDisabled: true,
    });

    expect(screen.getByText("Cleanup failed")).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Closing Task/ }).disabled).toBe(
      true,
    );

    unmount();
  });

  test("names a failed settings read that blocks the cleanup choice and retries it", async () => {
    let failRead = true;
    const settingsGet = mock(async () => {
      if (failRead) throw new Error("The settings file is not valid JSON.");
      return createSettingsSnapshotFixture();
    });
    const connection = createTestClientConnection({
      client: { workspaceGetSettingsSnapshot: settingsGet },
    });
    const { unmount } = render(
      <QueryProvider connection={connection}>
        <TaskCloseConfirmDialog
          open
          onOpenChange={() => {}}
          onCancel={() => {}}
          onConfirm={() => {}}
          operation={{ isPending: false, error: null, errorOutcomeUnknown: false }}
          impact={buildImpact()}
          isPreparing={false}
          removeWorktree={null}
          onRemoveWorktreeChange={() => {}}
          confirmDisabled
        />
      </QueryProvider>,
    );
    const message = "Unable to read the settings: The settings file is not valid JSON.";

    expect(await screen.findByText(message)).toBeDefined();
    failRead = false;
    // The read settles inside act, so React applies its result before the next check.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
    expect(settingsGet).toHaveBeenCalledTimes(2);

    unmount();
  });
});
