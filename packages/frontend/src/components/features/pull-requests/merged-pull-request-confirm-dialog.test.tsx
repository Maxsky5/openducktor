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

test("MergedPullRequestConfirmDialog uses provider-neutral text", () => {
  render(
    <MergedPullRequestConfirmDialog
      pullRequest={pullRequest}
      isLinking={false}
      onCancel={mock(() => {})}
      onConfirm={mock(() => {})}
    />,
  );

  expect(
    screen.getByText(
      "This branch is already merged. Linking the Pull Request will close the task and retire the builder worktree in one step.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/GitHub/)).toBeNull();
});
