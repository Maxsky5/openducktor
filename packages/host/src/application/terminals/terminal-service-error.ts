import type { TerminalFailure, TerminalFailureCode } from "@openducktor/contracts";
import { Data } from "effect";

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
  readonly details?: Readonly<Record<string, unknown>>;
}> {}

export const terminalServiceErrorToFailure = (error: TerminalServiceError): TerminalFailure => ({
  code: error.code,
  message: error.message,
  ...(error.terminalId ? { terminalId: error.terminalId } : {}),
  ...(error.workingDir ? { workingDir: error.workingDir } : {}),
  ...(error.details ? { details: { ...error.details } } : {}),
});
