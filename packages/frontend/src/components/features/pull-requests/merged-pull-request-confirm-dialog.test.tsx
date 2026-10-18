import { expect, mock, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { render, screen } from "@testing-library/react";
import { MergedPullRequestConfirmDialog } from "./merged-pull-request-confirm-dialog";

const pullRequest: PullRequest = {
  providerId: "forgejo",
  number: 42,
  url: "https://git.example.test/openai/openducktor/pulls/42",
  state: "merged",
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  mergedAt: "2026-09-02T10:00:00Z",
};

test.each(["Keep workspace results", null])(
  "MergedPullRequestConfirmDialog identifies its task with title %s",
  (taskTitle) => {
    const view = render(
      <MergedPullRequestConfirmDialog
        taskId="task-42"
        taskTitle={taskTitle}
        pullRequest={pullRequest}
        isLinking={false}
        onCancel={mock(() => {})}
        onConfirm={mock(() => {})}
      />,
    );

    try {
      expect(
        screen.getByText(
          "This branch is already merged. Linking the Pull Request will close the task and retire the builder worktree in one step.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/GitHub/)).toBeNull();
      if (taskTitle) expect(screen.getByText(taskTitle)).toBeTruthy();
      else expect(screen.queryByText("Keep workspace results")).toBeNull();
      expect(screen.getByText("task-42")).toBeTruthy();
    } finally {
      view.unmount();
    }
  },
);
