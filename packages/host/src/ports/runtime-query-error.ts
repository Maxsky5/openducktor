import type { RuntimeQueryFailure } from "@openducktor/contracts";
import { Data } from "effect";

export type RuntimeQueryIdentity = Pick<
  RuntimeQueryFailure,
  "repoPath" | "runtimeKind" | "workingDirectory" | "externalSessionId"
>;

export class RuntimeQueryError extends Data.TaggedError("RuntimeQueryError")<{
  readonly message: string;
  readonly failure: RuntimeQueryFailure;
  readonly cause?: unknown;
}> {}

export const runtimeQueryError = (
  operation: string,
  input: RuntimeQueryIdentity,
  code: RuntimeQueryFailure["code"],
  detail: string,
  cause?: unknown,
): RuntimeQueryError =>
  new RuntimeQueryError({
    message: detail,
    failure: {
      code,
      operation,
      repoPath: input.repoPath,
      runtimeKind: input.runtimeKind,
      workingDirectory: input.workingDirectory,
      externalSessionId: input.externalSessionId,
      summary: `Could not ${operation}.`,
      detail,
    },
    cause,
  });
