import { describe, expect, test } from "bun:test";
import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import { resolvePullRequestReviewAvailability } from "./pull-request-review-availability";

describe("resolvePullRequestReviewAvailability", () => {
  test("keeps review visible but unavailable when the provider refresh fails", () => {
    const gitProviderContext = {
      descriptor: {
        id: "github",
        label: "GitHub",
        description: "GitHub provider.",
        capabilities: {
          supportsPullRequests: true,
          supportsPullRequestReview: true,
        },
      },
      config: { id: "github", enabled: true, autoDetected: false },
      health: {
        providerId: "github",
        enabled: true,
        available: true,
        executablePath: "gh",
        version: "1.0.0",
        authenticated: true,
        account: "test",
        repositoryMappingValid: true,
      },
    } satisfies NonNullable<RepositoryGitProviderContext>;

    expect(
      resolvePullRequestReviewAvailability({
        gitProviderContext,
        gitProviderReadError: "Could not load the current Git provider: connection failed",
        linkedPullRequest: {
          providerId: "github",
          number: 7,
          url: "https://example.com/pulls/7",
          state: "open",
          createdAt: "2026-09-03T10:00:00.000Z",
          updatedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    ).toEqual({
      canShowPullRequestReview: true,
      hasLinkedPullRequest: true,
      unavailableReason: "Could not load the current Git provider: connection failed",
    });
  });

  test("keeps review visible but unavailable when the initial provider read fails", () => {
    expect(
      resolvePullRequestReviewAvailability({
        gitProviderContext: undefined,
        gitProviderReadError: "Could not load the current Git provider: connection failed",
        linkedPullRequest: {
          providerId: "github",
          number: 7,
          url: "https://example.com/pulls/7",
          state: "open",
          createdAt: "2026-09-03T10:00:00.000Z",
          updatedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    ).toEqual({
      canShowPullRequestReview: true,
      hasLinkedPullRequest: true,
      unavailableReason: "Could not load the current Git provider: connection failed",
    });
  });

  test("hides review for a linked Pull Request when the provider does not support review", () => {
    const gitProviderContext = {
      descriptor: {
        id: "fake",
        label: "Fake Git",
        description: "Fake provider without Pull Request review.",
        capabilities: {
          supportsPullRequests: true,
          supportsPullRequestReview: false,
        },
      },
      config: { id: "fake", enabled: true, autoDetected: false },
      health: {
        providerId: "fake",
        enabled: true,
        available: true,
        executablePath: "fake-git",
        version: "1.0.0",
        authenticated: true,
        account: "test",
        repositoryMappingValid: true,
      },
    } satisfies NonNullable<RepositoryGitProviderContext>;

    expect(
      resolvePullRequestReviewAvailability({
        gitProviderContext,
        gitProviderReadError: "Could not load the current Git provider: connection failed",
        linkedPullRequest: {
          providerId: "fake",
          number: 7,
          url: "https://example.com/pulls/7",
          state: "open",
          createdAt: "2026-09-03T10:00:00.000Z",
          updatedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    ).toEqual({
      canShowPullRequestReview: false,
      hasLinkedPullRequest: true,
      unavailableReason: null,
    });
  });
});
