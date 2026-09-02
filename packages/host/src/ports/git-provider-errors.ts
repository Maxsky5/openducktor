import type { GitProviderId, GitProviderRepository } from "@openducktor/contracts";
import { Data } from "effect";

export type GitProviderCapability = "pull_requests" | "pull_request_review";

export class GitProviderCapabilityError extends Data.TaggedError("GitProviderCapabilityError")<{
  readonly providerId: GitProviderId;
  readonly capability: GitProviderCapability;
  readonly message: string;
}> {}

export type GitProviderResolutionFailureReason = "not_configured" | "disabled" | "not_registered";

export class GitProviderResolutionError extends Data.TaggedError("GitProviderResolutionError")<{
  readonly reason: GitProviderResolutionFailureReason;
  readonly providerId?: GitProviderId;
  readonly message: string;
}> {}

export type GitProviderRepositoryFailureReason =
  | "no_matching_remote"
  | "ambiguous_matching_remotes";

export class GitProviderRepositoryError extends Data.TaggedError("GitProviderRepositoryError")<{
  readonly reason: GitProviderRepositoryFailureReason;
  readonly providerId: GitProviderId;
  readonly repoPath: string;
  readonly message: string;
  readonly remoteNames?: readonly string[];
  readonly repositories?: readonly GitProviderRepository[];
}> {}

export type GitProviderRegistrationFailureReason =
  | "duplicate_provider_id"
  | "declared_capability_missing_port"
  | "undeclared_capability_has_port"
  | "capability_provider_id_mismatch";

export class GitProviderRegistrationError extends Data.TaggedError("GitProviderRegistrationError")<{
  readonly reason: GitProviderRegistrationFailureReason;
  readonly providerId: GitProviderId;
  readonly capability?: GitProviderCapability;
  readonly message: string;
}> {}
