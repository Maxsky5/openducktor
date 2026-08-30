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

export const terminalServiceErrorToFailure = (error: TerminalServiceError): TerminalFailure => {
  const failure: TerminalFailure = { code: error.code, message: error.message };
  if (error.terminalId) {
    failure.terminalId = error.terminalId;
  }
  if (error.workingDir) {
    failure.workingDir = error.workingDir;
  }
  if (error.details) {
    failure.details = { ...error.details };
  }
  return failure;
};
