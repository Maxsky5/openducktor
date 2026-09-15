import { Data } from "effect";

export type ProcessEnvironmentErrorReason =
  | "invalid_output"
  | "output_limit"
  | "shell_unavailable"
  | "spawn_failed"
  | "timed_out"
  | "unexpected_exit";

export class ProcessEnvironmentError extends Data.TaggedError("ProcessEnvironmentError")<{
  readonly message: string;
  readonly reason: ProcessEnvironmentErrorReason;
  readonly shell: string;
  readonly cause?: unknown;
}> {}

export const processEnvironmentError = (
  shell: string,
  reason: ProcessEnvironmentErrorReason,
  message: string,
  cause?: unknown,
): ProcessEnvironmentError =>
  cause === undefined
    ? new ProcessEnvironmentError({ shell, reason, message })
    : new ProcessEnvironmentError({ shell, reason, message, cause });
