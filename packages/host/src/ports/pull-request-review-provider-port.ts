import type { GitProviderId, PullRequest, PullRequestReviewContext } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostValidationErrorAggregate } from "../effect/host-errors";
import type { GitProviderWorkspace } from "./git-provider-workspace";

export type PullRequestReviewProviderInput = {
  repoConfig: GitProviderWorkspace;
  linkedPullRequest: PullRequest;
};

export type PullRequestReviewProviderPort = {
  providerId: GitProviderId;
  readContext(
    input: PullRequestReviewProviderInput,
  ): Effect.Effect<PullRequestReviewContext, HostValidationErrorAggregate>;
};
