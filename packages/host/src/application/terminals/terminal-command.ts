import type {
  TerminalCloseRequest,
  TerminalCreateResponse,
  TerminalOwnedLaunchSpec,
  TerminalStartedBy,
  TerminalCommandResult,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TerminalServiceError } from "./terminal-service-error";

/** The lines of a command terminal. They run in order and stop after the first failed line. */
export type TerminalCommandLines = readonly [string, ...string[]];

export type { TerminalCommandResult } from "@openducktor/contracts";

export type TerminalCommandRequest = TerminalOwnedLaunchSpec & {
  label: string;
  commandLines: TerminalCommandLines;
  startedBy: TerminalStartedBy;
  onResult?: (result: TerminalCommandResult) => void;
};

export type StartedCommandTerminal = {
  response: TerminalCreateResponse;
  /** Completes when the command ends, or when its terminal closes or fails first. */
  result: Effect.Effect<TerminalCommandResult>;
};

/** Starts terminals that run a command, then continue as a normal shell. */
export type TerminalCommandService = {
  /** Validates the requested owner target as `create` does, then starts the command terminal. */
  startCommand(
    request: TerminalCommandRequest,
  ): Effect.Effect<StartedCommandTerminal, TerminalServiceError>;
  /**
   * Starts a command terminal in a target that the caller created and validated. A new chat
   * worktree has no saved chat record yet, so the owner check of `startCommand` cannot pass.
   */
  startCommandInPreparedTarget(
    request: TerminalCommandRequest,
  ): Effect.Effect<StartedCommandTerminal, TerminalServiceError>;
  readOutputTail(
    terminalId: string,
    lineCount: number,
  ): Effect.Effect<readonly string[], TerminalServiceError>;
  close(input: TerminalCloseRequest): Effect.Effect<void, TerminalServiceError>;
};
