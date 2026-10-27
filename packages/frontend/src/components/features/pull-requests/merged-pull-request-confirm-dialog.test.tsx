import { describe, expect, mock, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { QueryProvider } from "@/test-utils/query-provider";
import { WorkspaceProviders } from "@/test-utils/workspace-providers";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { MergedPullRequestConfirmDialog } from "./merged-pull-request-confirm-dialog";

enableReactActEnvironment();

const pullRequest: PullRequest = {
  providerId: "forgejo",
  number: 42,
  url: "https://git.example.test/openai/openducktor/pulls/42",
  state: "merged",
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  mergedAt: "2026-09-02T10:00:00Z",
};

const keptWorktree = async () => ({
  worktreePaths: ["/worktrees/task-42"],
  branchNames: ["odt/task-42"],
  uncommittedFileCount: 0,
  mergeCandidate: false,
  branchOid: null,
});

/**
 * The link reads the settings, the cleanup impact, the terminals, and the live sessions that it
 * stops, as a close does.
 */
const createConnection = (readImpact: typeof keptWorktree = keptWorktree) =>
  createTestClientConnection({
    client: {
      workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
      taskWorktreeCleanupImpactGet: readImpact,
      terminalList: async () => ({ hostInstanceId: "host", terminals: [] }),
      taskStopImpactGet: async () => ({ stoppableSessionCount: 1 }),
      taskMergeStatusGet: async (repoPath) => ({ repoPath, tasks: [] }),
    },
  });

const renderDialog = (
  props: {
    taskTitle?: string | null;
    onConfirm?: (options: { removeWorktree: boolean }) => void;
    readImpact?: typeof keptWorktree;
  } = {},
) =>
  render(
    <QueryProvider connection={createConnection(props.readImpact)}>
      <WorkspaceProviders>
        <MergedPullRequestConfirmDialog
          taskId="task-42"
          taskTitle={props.taskTitle === undefined ? "Keep workspace results" : props.taskTitle}
          taskRemoveWorktreeOnClose={false}
          pullRequest={pullRequest}
          isLinking={false}
          onCancel={mock(() => {})}
          onConfirm={props.onConfirm ?? mock(() => {})}
        />
      </WorkspaceProviders>
    </QueryProvider>,
  );

describe("MergedPullRequestConfirmDialog", () => {
  test.each(["Keep workspace results", null])("identifies its task with title %s", (taskTitle) => {
    const view = renderDialog({ taskTitle });

    try {
      expect(
        screen.getByText(
          "This branch is already merged. Linking the Pull Request closes the task in one step.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/GitHub/)).toBeNull();
      if (taskTitle) expect(screen.getByText(taskTitle)).toBeTruthy();
      else expect(screen.queryByText("Keep workspace results")).toBeNull();
      expect(screen.getByText("task-42")).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  test("links with the cleanup choice that the task override sets", async () => {
    const onConfirm = mock((_options: { removeWorktree: boolean }) => {});
    const view = renderDialog({ onConfirm });

    try {
      const confirm = screen.getByTestId<HTMLButtonElement>("merged-pr-dialog-confirm-button");
      await waitFor(() => {
        expect(confirm.disabled).toBe(false);
      });
      expect(
        screen
          .getByRole<HTMLInputElement>("switch", { name: "Remove worktree and branch" })
          .getAttribute("aria-checked"),
      ).toBe("false");
      // The link stops the live sessions of the task, as a close does.
      expect(
        screen.getByText("1 active agent session will be stopped before closing."),
      ).toBeTruthy();

      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledWith({ removeWorktree: false });
    } finally {
      view.unmount();
    }
  });

  test("shows a failed worktree read with Retry and links after the read works", async () => {
    let failRead = true;
    const onConfirm = mock((_options: { removeWorktree: boolean }) => {});
    const view = renderDialog({
      onConfirm,
      readImpact: async () => {
        if (failRead) throw new Error("Unable to read the task worktree: permission denied.");
        return keptWorktree();
      },
    });

    try {
      const confirm = screen.getByTestId<HTMLButtonElement>("merged-pr-dialog-confirm-button");
      expect(
        await screen.findByText("Unable to read the task worktree: permission denied."),
      ).toBeTruthy();
      expect(confirm.disabled).toBe(true);

      failRead = false;
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => {
        expect(confirm.disabled).toBe(false);
      });
      expect(screen.queryByText("Unable to read the task worktree: permission denied.")).toBeNull();

      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledWith({ removeWorktree: false });
    } finally {
      view.unmount();
    }
  });
});
