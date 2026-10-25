import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { createGitProviderContextFixture } from "../../test-support/shared-test-fixtures";
import { pullRequestLabel, resolveTaskPullRequestActions } from "./pull-request-presentation";

const pullRequest: PullRequest = {
  providerId: "github",
  number: 42,
  url: "https://github.com/example/repo/pull/42",
  state: "open",
  createdAt: "2026-02-22T12:00:00.000Z",
  updatedAt: "2026-02-22T12:00:00.000Z",
};

describe("pullRequestLabel", () => {
  test("names the pull request by number", () => {
    expect(pullRequestLabel(pullRequest)).toBe("PR #42");
  });
});

describe("resolveTaskPullRequestActions", () => {
  const provider = createGitProviderContextFixture();

  test("offers Detect PR for a task without a pull request in a status that keeps one", () => {
    expect(
      resolveTaskPullRequestActions(
        { status: "human_review", pullRequest: undefined },
        provider,
        null,
      ),
    ).toEqual({ showDetect: true, showUnlink: false, detectDisabledReason: null });
  });

  test("offers Unlink PR for a linked pull request", () => {
    expect(
      resolveTaskPullRequestActions({ status: "in_progress", pullRequest }, provider, null),
    ).toEqual({ showDetect: false, showUnlink: true, detectDisabledReason: null });
  });

  test("offers neither action in a status that does not keep pull request data", () => {
    expect(
      resolveTaskPullRequestActions({ status: "open", pullRequest: undefined }, provider, null),
    ).toMatchObject({ showDetect: false, showUnlink: false });
    expect(
      resolveTaskPullRequestActions({ status: "closed", pullRequest }, provider, null),
    ).toMatchObject({ showDetect: false, showUnlink: false });
  });

  test("keeps Detect PR visible with its reason when the provider read fails or is unavailable", () => {
    expect(
      resolveTaskPullRequestActions(
        { status: "ai_review", pullRequest: undefined },
        undefined,
        "Could not read the Git provider.",
      ),
    ).toEqual({
      showDetect: true,
      showUnlink: false,
      detectDisabledReason: "Could not read the Git provider.",
    });
    expect(
      resolveTaskPullRequestActions(
        { status: "ai_review", pullRequest: undefined },
        createGitProviderContextFixture({ available: false }),
        null,
      ).detectDisabledReason,
    ).toBe("Sign in to GitHub CLI.");
  });

  test("hides Detect PR when the provider has no pull requests", () => {
    expect(
      resolveTaskPullRequestActions(
        { status: "ai_review", pullRequest: undefined },
        createGitProviderContextFixture({ supportsPullRequests: false }),
        null,
      ).showDetect,
    ).toBe(false);
  });
});
