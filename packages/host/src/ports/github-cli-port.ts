import type { SystemCommandRunOptions, SystemCommandRunResult } from "./system-command-port";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
} from "../effect/host-errors";
import type { Effect } from "effect";
import type { ToolDiscoveryError } from "./tool-discovery-port";

export type GithubCliAuth = {
  authenticated: boolean;
  account: string | null;
  reason: string | null;
};

export type GithubCliPort = {
  getAuth(
    ghCommand: string,
    host: string,
  ): Effect.Effect<GithubCliAuth, HostOperationErrorAggregate>;
  readVersion(
    ghCommand: string,
    options?: SystemCommandRunOptions,
  ): Effect.Effect<string | null, HostPathAccessErrorAggregate>;
  run(
    ghCommand: string,
    args: string[],
    options?: SystemCommandRunOptions,
  ): Effect.Effect<SystemCommandRunResult, HostOperationErrorAggregate>;
};

export type ResolvedGithubCommand = {
  ghCommand: string;
  githubCli: GithubCliPort;
};

export type GithubCommandResolverPort = {
  resolve(): Effect.Effect<ResolvedGithubCommand, ToolDiscoveryError>;
};
