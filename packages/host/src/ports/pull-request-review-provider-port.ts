import type {
  GitProviderId,
  PullRequest,
  PullRequestReviewContext,
  RepoConfig,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostValidationError } from "../effect/host-errors";

export type PullRequestReviewProviderInput = {
  repoConfig: RepoConfig;
  linkedPullRequest: PullRequest;
};

export type PullRequestReviewProviderPort = {
  providerId: GitProviderId;
  readContext(
    input: PullRequestReviewProviderInput,
  ): Effect.Effect<PullRequestReviewContext, HostValidationError>;
};
