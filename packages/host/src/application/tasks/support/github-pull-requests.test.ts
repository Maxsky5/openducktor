import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { pullRequestRecordsMatch } from "./github-pull-requests";

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  providerId: "github",
  number: 42,
  url: "https://github.com/openducktor/openducktor/pull/42",
  state: "open",
  createdAt: "2026-05-01T10:00:00Z",
  updatedAt: "2026-05-02T10:00:00Z",
  lastSyncedAt: "2026-05-03T10:00:00Z",
  ...overrides,
});

describe("pullRequestRecordsMatch", () => {
  test("ignores sync timestamps so background polling does not churn unchanged tasks", () => {
    expect(
      pullRequestRecordsMatch(
        pullRequest({ lastSyncedAt: "2026-05-03T10:00:00Z" }),
        pullRequest({ lastSyncedAt: "2026-05-03T10:05:00Z" }),
      ),
    ).toBe(true);
  });

  test("detects user-visible pull request changes", () => {
    expect(
      pullRequestRecordsMatch(pullRequest({ state: "open" }), pullRequest({ state: "merged" })),
    ).toBe(false);
  });
});
