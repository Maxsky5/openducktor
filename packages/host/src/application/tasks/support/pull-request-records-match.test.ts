import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import { pullRequestRecordsMatch } from "./pull-request-records-match";

const stored: PullRequest = {
  providerId: "github",
  number: 42,
  url: "https://github.com/openai/openducktor/pull/42",
  state: "merged",
  createdAt: "2011-01-26T19:01:12.000Z",
  updatedAt: "2011-01-26T19:02:00.000Z",
  mergedAt: "2011-01-26T19:03:00.000Z",
  closedAt: "2011-01-26T19:03:00.000Z",
  lastSyncedAt: "2011-01-26T19:05:00.000Z",
};

describe("pullRequestRecordsMatch", () => {
  test("matches dates that name the same instant in other ISO formats", () => {
    expect(
      pullRequestRecordsMatch(stored, {
        ...stored,
        createdAt: "2011-01-26T19:01:12Z",
        updatedAt: "2011-01-26T19:02:00.0000000Z",
        mergedAt: "2011-01-26T20:03:00+01:00",
        closedAt: "2011-01-26T19:03:00.0001234Z",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  test("does not match a different instant or a missing date", () => {
    expect(pullRequestRecordsMatch(stored, { ...stored, updatedAt: "2011-01-26T19:02:01Z" })).toBe(
      false,
    );
    expect(pullRequestRecordsMatch(stored, { ...stored, mergedAt: undefined })).toBe(false);
  });

  test("compares other fields by value without key order", () => {
    const reordered: PullRequest = {
      url: stored.url,
      number: stored.number,
      providerId: stored.providerId,
      state: stored.state,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      mergedAt: stored.mergedAt,
      closedAt: stored.closedAt,
    };
    expect(pullRequestRecordsMatch(stored, reordered)).toBe(true);
    expect(pullRequestRecordsMatch(stored, { ...stored, state: "closed_unmerged" })).toBe(false);
  });
});
