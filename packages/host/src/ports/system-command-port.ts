import { Context, type Effect } from "effect";
import type { HostOperationError, HostPathAccessError } from "../effect/host-errors";

export type SystemCommandRunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type SystemCommandRunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type SystemCommandResolveOptions = {
  env?: NodeJS.ProcessEnv;
  searchPath?: readonly string[];
};

export type SystemCommandPort = {
  resolveCommandPath(
    command: string,
    options?: SystemCommandResolveOptions,
  ): Effect.Effect<string | null, HostPathAccessError>;
  versionCommand(
    command: string,
    args: string[],
    options?: SystemCommandRunOptions,
  ): Effect.Effect<string | null, HostPathAccessError>;
  runCommandAllowFailure(
    command: string,
    args: string[],
    options?: SystemCommandRunOptions,
  ): Effect.Effect<SystemCommandRunResult, HostOperationError>;
};

export class SystemCommandPortTag extends Context.Tag("@openducktor/host/SystemCommandPort")<
  SystemCommandPortTag,
  SystemCommandPort
>() {}
