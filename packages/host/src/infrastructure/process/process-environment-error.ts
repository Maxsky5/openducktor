import { Data } from "effect";
import type { UserPathErrorReason } from "../../ports/user-environment-port";

export class ProcessEnvironmentError extends Data.TaggedError("ProcessEnvironmentError")<{
  readonly message: string;
  readonly reason: UserPathErrorReason;
  readonly shell: string;
  readonly cause?: unknown;
}> {}

export const processEnvironmentError = (
  shell: string,
  reason: UserPathErrorReason,
  message: string,
  cause?: unknown,
): ProcessEnvironmentError =>
  cause === undefined
    ? new ProcessEnvironmentError({ shell, reason, message })
    : new ProcessEnvironmentError({ shell, reason, message, cause });
