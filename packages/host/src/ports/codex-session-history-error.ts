import type { SessionHistoryFailure } from "@openducktor/contracts";
import { Data } from "effect";

export class CodexSessionHistoryError extends Data.TaggedError("CodexSessionHistoryError")<{
  readonly message: string;
  readonly failure: SessionHistoryFailure;
  readonly runtimeId: string;
  readonly threadId: string;
  readonly cause?: unknown | undefined;
}> {}
