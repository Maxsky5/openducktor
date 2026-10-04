import type { RepoConfig } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "./azure-devops-connection-port";

/** Owns temporary credentials independently of saved workspace scopes. */
export type WorkspaceProviderSetupCredentialsPort = {
  connection: AzureDevOpsConnectionPort;
  transfer(source: RepoConfig, destination: RepoConfig): Effect.Effect<void, HostError>;
  release(source: RepoConfig): Effect.Effect<void, HostError>;
  complete(source: RepoConfig): Effect.Effect<void, HostError>;
};
