import type {
  AzureDevOpsConnectionState,
  AzureDevOpsDeviceCode,
  AzureDevOpsRepository,
  RepoConfig,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

export type AzureDevOpsAuthorization = {
  headerValue: string;
  account: string | null;
};

export type AzureDevOpsConnectionPort = {
  getAuthorization(
    repoConfig: RepoConfig,
    repository: AzureDevOpsRepository,
  ): Effect.Effect<AzureDevOpsAuthorization, HostError>;
  getState(
    repoConfig: RepoConfig,
    repository: AzureDevOpsRepository,
  ): Effect.Effect<AzureDevOpsConnectionState, HostError>;
  replacePat(
    repoConfig: RepoConfig,
    repository: AzureDevOpsRepository,
    pat: string,
  ): Effect.Effect<void, HostError>;
  startCloudSignIn(
    repoConfig: RepoConfig,
    repository: AzureDevOpsRepository,
  ): Effect.Effect<AzureDevOpsDeviceCode, HostError>;
  cancelCloudSignIn(attemptId: string): Effect.Effect<void, HostError>;
  disconnect(
    repoConfig: RepoConfig,
    repository: AzureDevOpsRepository,
  ): Effect.Effect<void, HostError>;
};
