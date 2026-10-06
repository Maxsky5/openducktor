import { Context, Data, type Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

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
  // Readiness does not release the handle. The owner must stop it after failure or cancellation.
  waitForReady(): Effect.Effect<void, DevServerProcessStartExitError | HostOperationErrorAggregate>;
  pauseOutput(): Effect.Effect<void, HostOperationErrorAggregate>;
  resumeOutput(): Effect.Effect<void, HostOperationErrorAggregate>;
  stop(): Effect.Effect<void, HostOperationErrorAggregate>;
};
export type DevServerProcessPort = {
  // Return the owned handle after spawn so flow control is active before the readiness wait.
  start(
    input: DevServerProcessStartInput,
  ): Effect.Effect<
    DevServerProcessHandle,
    DevServerProcessStartExitError | HostOperationErrorAggregate | HostValidationErrorAggregate
  >;
};

export class DevServerProcessPortTag extends Context.Service<
  DevServerProcessPortTag,
  DevServerProcessPort
>()("@openducktor/host/DevServerProcessPort") {}

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
