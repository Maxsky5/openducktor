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
  linkedPullRequest: PullRequest | null;
  workingDirectory?: string;
};

export type PullRequestReviewProviderPort = {
  providerId: GitProviderId;
  isEnabled(repoConfig: RepoConfig): boolean;
  readContext(
    input: PullRequestReviewProviderInput,
  ): Effect.Effect<PullRequestReviewContext, HostValidationError>;
};
