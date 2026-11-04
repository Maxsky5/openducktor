import type {
  AzureDevOpsConnectionState,
  AzureDevOpsDeviceCode,
  AzureDevOpsRepository,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { GitProviderWorkspace } from "./git-provider-workspace";

export type AzureDevOpsAuthorization = {
  headerValue: string;
  account: string | null;
};

export type AzureDevOpsConnectionPort = {
  getAuthorization(
    repoConfig: GitProviderWorkspace,
    repository: AzureDevOpsRepository,
  ): Effect.Effect<AzureDevOpsAuthorization, HostError>;
  getState(
    repoConfig: GitProviderWorkspace,
    repository: AzureDevOpsRepository,
  ): Effect.Effect<AzureDevOpsConnectionState, HostError>;
  replacePat(
    repoConfig: GitProviderWorkspace,
    repository: AzureDevOpsRepository,
    pat: string,
  ): Effect.Effect<void, HostError>;
  startCloudSignIn(
    repoConfig: GitProviderWorkspace,
    repository: AzureDevOpsRepository,
  ): Effect.Effect<AzureDevOpsDeviceCode, HostError>;
  cancelCloudSignIn(attemptId: string): Effect.Effect<void, HostError>;
  disconnect(
    repoConfig: GitProviderWorkspace,
    repository: AzureDevOpsRepository,
  ): Effect.Effect<void, HostError>;
  removeWorkspaceCredentials(repoConfig: GitProviderWorkspace): Effect.Effect<void, HostError>;
  shutdown(): Effect.Effect<void>;
};
