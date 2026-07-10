import { describe, expect, test } from "bun:test";
import { pullRequestReviewContextSchema } from "./pull-request-review-schemas";

describe("pullRequestReviewContextSchema", () => {
  test("accepts provider-neutral pull request review contexts", () => {
    expect(
      pullRequestReviewContextSchema.parse({
        status: "unavailable",
        providerId: "gitlab",
        reason: "GitLab integration is not configured.",
      }),
    ).toEqual({
      status: "unavailable",
      providerId: "gitlab",
      reason: "GitLab integration is not configured.",
    });
  });
});
