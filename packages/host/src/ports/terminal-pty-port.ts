import { Context, Data, type Effect } from "effect";

export type TerminalGrid = {
  columns: number;
  rows: number;
};

export type TerminalPtyLaunchPlan = {
  shell: string;
  args: readonly string[];
  /**
   * The adapter writes this script to a temporary `.cmd` file, runs it with `shell` instead of
   * `args`, and removes the file after the process exits.
   */
  windowsBatchScript?: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
  grid: TerminalGrid;
  commandNonce?: string;
  /** The process runs one command and exits. Its exit code is a result, not a start failure. */
  runsCommand?: boolean;
};

export type TerminalPtyExit = {
  exitCode: number | null;
  signal: string | null;
};

export type TerminalPtyHandlers = {
  onOutput(data: Uint8Array): void;
  onFailure(error: TerminalPtyError): void;
  /** Adapters must invoke this only after the final output/EOF callback. */
  onExit(exit: TerminalPtyExit): void;
};

export class TerminalPtyError extends Data.TaggedError("TerminalPtyError")<{
  readonly code: "unsupported_runtime" | "spawn_failed" | "operation_failed";
  readonly operation: "start" | "write" | "resize" | "pause" | "resume" | "inspect" | "terminate";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type TerminalProducerHandle = {
  readonly supportsOutputPause: boolean;
  pauseOutput(): Effect.Effect<void, TerminalPtyError>;
  resumeOutput(): Effect.Effect<void, TerminalPtyError>;
  terminate(): Effect.Effect<void, TerminalPtyError>;
};

export type TerminalPtyHandle = TerminalProducerHandle & {
  hasChildProcesses(): Effect.Effect<boolean, TerminalPtyError>;
  write(data: Uint8Array): Effect.Effect<void, TerminalPtyError>;
  resize(grid: TerminalGrid): Effect.Effect<void, TerminalPtyError>;
};

export type TerminalPtyPort = {
  start(
    plan: TerminalPtyLaunchPlan,
    handlers: TerminalPtyHandlers,
  ): Effect.Effect<TerminalPtyHandle, TerminalPtyError>;
};

export class TerminalPtyPortTag extends Context.Service<TerminalPtyPortTag, TerminalPtyPort>()(
  "@openducktor/host/TerminalPtyPort",
) {}
