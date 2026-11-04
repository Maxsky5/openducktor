import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "./azure-devops-connection-port";
import type { GitProviderWorkspace } from "./git-provider-workspace";

/** Owns temporary credentials independently of saved workspace scopes. */
export type WorkspaceProviderSetupCredentialsPort = {
  connection: AzureDevOpsConnectionPort;
  transfer(
    source: GitProviderWorkspace,
    destination: GitProviderWorkspace,
  ): Effect.Effect<void, HostError>;
  release(source: GitProviderWorkspace): Effect.Effect<void, HostError>;
  complete(source: GitProviderWorkspace): Effect.Effect<void, HostError>;
};
