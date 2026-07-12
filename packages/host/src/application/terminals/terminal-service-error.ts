import type { TerminalFailureCode } from "@openducktor/contracts";
import { Data } from "effect";

export class TerminalServiceError extends Data.TaggedError("TerminalServiceError")<{
  readonly code: TerminalFailureCode;
  readonly operation:
    | "create"
    | "list"
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
