import type { RepoConfig } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { GitProviderRepositoryError } from "./git-provider-errors";

export type AzureAreaPathsPort = {
  list(repoConfig: RepoConfig): Effect.Effect<string[], HostError | GitProviderRepositoryError>;
};
