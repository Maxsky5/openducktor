import type { SystemCommandRunOptions, SystemCommandRunResult } from "./system-command-port";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
} from "../effect/host-errors";
import type { Effect } from "effect";

export type GithubCliAuthentication = {
  authenticated: boolean;
  account: string | null;
  reason: string | null;
};

export type GithubCliPort = {
  getAuthentication(
    ghCommand: string,
    host: string,
  ): Effect.Effect<GithubCliAuthentication, HostOperationErrorAggregate>;
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
