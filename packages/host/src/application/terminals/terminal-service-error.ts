import type { TerminalFailure, TerminalFailureCode } from "@openducktor/contracts";
import { Data } from "effect";

type TerminalFailureDetails = NonNullable<TerminalFailure["details"]>;

export class TerminalServiceError extends Data.TaggedError("TerminalServiceError")<{
  readonly code: TerminalFailureCode;
  readonly operation:
    | "create"
    | "list"
    | "prepare_path_input"
    | "attach"
    | "write"
    | "resize"
    | "ack"
    | "detach"
    | "close"
    | "close_by_task"
    | "dispose";
  readonly message: string;
  readonly terminalId?: string;
  readonly workingDir?: string;
  readonly cause?: unknown;
  readonly details?: TerminalFailureDetails;
}> {}

export const terminalServiceErrorToFailure = (error: TerminalServiceError): TerminalFailure => ({
  code: error.code,
  message: error.message,
  ...(error.terminalId ? { terminalId: error.terminalId } : undefined),
  ...(error.workingDir ? { workingDir: error.workingDir } : undefined),
  ...(error.details ? { details: { ...error.details } } : undefined),
});
