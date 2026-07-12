import { describe, expect, test } from "bun:test";
import { pullRequestReviewQueryKeys } from "./pull-request-review";

describe("pullRequestReviewQueryKeys", () => {
  test("keys linked pull request snapshots by provider and number", () => {
    const pullRequestOne = pullRequestReviewQueryKeys.context({
      repoPath: "/repo",
      taskId: "task-1",
      pullRequest: { providerId: "github", number: 1 },
    });
    const pullRequestTwo = pullRequestReviewQueryKeys.context({
      repoPath: "/repo",
      taskId: "task-1",
      pullRequest: { providerId: "github", number: 2 },
    });
    const gitlabPullRequest = pullRequestReviewQueryKeys.context({
      repoPath: "/repo",
      taskId: "task-1",
      pullRequest: { providerId: "gitlab", number: 1 },
    });

    expect(pullRequestOne).not.toEqual(pullRequestTwo);
    expect(pullRequestOne).not.toEqual(gitlabPullRequest);
  });
});
