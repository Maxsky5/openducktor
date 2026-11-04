import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { GitProviderRepositoryError } from "./git-provider-errors";
import type { GitProviderWorkspace } from "./git-provider-workspace";

export type AzureAreaPathsPort = {
  list(
    repoConfig: GitProviderWorkspace,
  ): Effect.Effect<string[], HostError | GitProviderRepositoryError>;
};
