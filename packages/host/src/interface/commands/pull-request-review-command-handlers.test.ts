import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { PullRequestReviewService } from "../../application/pull-requests/pull-request-review-service";
import { createEffectHostCommandRouter } from "../router/host-command-router";
import { createPullRequestReviewCommandHandlers } from "./pull-request-review-command-handlers";

describe("createPullRequestReviewCommandHandlers", () => {
  test("preserves significant whitespace in repository paths", async () => {
    const receivedRepoPaths: string[] = [];
    const service: PullRequestReviewService = {
      getContext: (input) => {
        receivedRepoPaths.push(input.repoPath);
        return Effect.succeed({
          status: "no_pull_request",
          providerId: "unknown",
          reason: "No linked pull request.",
        });
      },
    };
    const router = createEffectHostCommandRouter({
      handlers: createPullRequestReviewCommandHandlers(service),
    });

    await Effect.runPromise(
      router.invoke("pull_request_review_context_get", { repoPath: " /repo " }),
    );

    expect(receivedRepoPaths).toEqual([" /repo "]);
  });

  test("rejects whitespace-only repository paths", async () => {
    const service: PullRequestReviewService = {
      getContext: () => Effect.die("not used"),
    };
    const router = createEffectHostCommandRouter({
      handlers: createPullRequestReviewCommandHandlers(service),
    });

    await expect(
      Effect.runPromise(router.invoke("pull_request_review_context_get", { repoPath: "   " })),
    ).rejects.toThrow("repoPath is required.");
  });
});
