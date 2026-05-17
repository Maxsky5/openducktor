import type { Effect } from "effect";
import { Data } from "effect";
import type { HostOperationError, HostValidationError } from "../effect/host-errors";

export type DevServerProcessExit = {
  pid: number;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
};
export type DevServerProcessOutput = {
  data: string;
};
export type DevServerProcessStartInput = {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  onExit: (exit: DevServerProcessExit) => void;
  onOutput: (output: DevServerProcessOutput) => void;
};
export type DevServerProcessHandle = {
  pid: number;
  stop(): Effect.Effect<void, HostOperationError>;
};
export type DevServerProcessPort = {
  start(
    input: DevServerProcessStartInput,
  ): Effect.Effect<
    DevServerProcessHandle,
    DevServerProcessStartExitError | HostOperationError | HostValidationError
  >;
};
export const devServerExitMessage = (exitCode: number | null, signal: string | null): string => {
  if (exitCode !== null) {
    return `Dev server exited with code ${exitCode}.`;
  }
  if (signal !== null) {
    return `Dev server exited after receiving signal ${signal}.`;
  }
  return "Dev server exited after receiving a signal.";
};
export class DevServerProcessStartExitError extends Data.TaggedError(
  "DevServerProcessStartExitError",
)<{
  readonly message: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
}> {
  constructor(exitCode: number | null, signal: string | null) {
    super({
      message: devServerExitMessage(exitCode, signal),
      exitCode,
      signal,
    });
  }
}
