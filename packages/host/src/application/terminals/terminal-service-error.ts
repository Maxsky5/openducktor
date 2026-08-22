import type { TerminalFailure, TerminalFailureCode } from "@openducktor/contracts";
import { Data } from "effect";
import type { JsonValue } from "@openducktor/contracts";

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
  readonly details?: Readonly<Record<string, JsonValue>>;
}> {}

export const terminalServiceErrorToFailure = (error: TerminalServiceError): TerminalFailure => ({
  code: error.code,
  message: error.message,
  ...(() => {
    if (error.terminalId) {
      return { terminalId: error.terminalId };
    }
    return {};
  })(),
  ...(() => {
    if (error.workingDir) {
      return { workingDir: error.workingDir };
    }
    return {};
  })(),
  ...(() => {
    if (error.details) {
      return { details: { ...error.details } };
    }
    return {};
  })(),
});
