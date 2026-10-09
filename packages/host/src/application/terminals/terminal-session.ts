import type { TerminalSummary } from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import type { TerminalGrid, TerminalPtyHandle } from "../../ports/terminal-pty-port";
import type { TerminalCommandResult } from "./terminal-command";
import { TERMINAL_LIMITS } from "./terminal-limits";
import { TerminalScreenState } from "./terminal-screen-state";
import { TerminalSessionOutput } from "./terminal-session-output";
import type { TerminalTitleTracker } from "./terminal-title-tracker";
import { type SerialLane } from "../../effect/serial-gate";

/** The command of a command terminal. The result settles once, when the command ends. */
export type TerminalCommandRun = {
  phase: "command" | "shell";
  readonly result: Deferred.Deferred<TerminalCommandResult>;
};

export type TerminalSession = {
  summary: TerminalSummary;
  output: TerminalSessionOutput;
  screen: TerminalScreenState;
  screenReleaseStarted: boolean;
  operations: SerialLane;
  grid: TerminalGrid;
  readonly shell: string;
  command: string | null;
  readonly commandRun: TerminalCommandRun | null;
  resources: TerminalSessionResources;
};

class TerminalSessionResources {
  private currentHandle: TerminalPtyHandle | null = null;
  private disposed = false;

  constructor(private readonly titleTracker: TerminalTitleTracker) {}

  get handle(): TerminalPtyHandle | null {
    return this.currentHandle;
  }

  activate(handle: TerminalPtyHandle): boolean {
    if (this.disposed) return false;
    this.currentHandle = handle;
    return true;
  }

  /** A command terminal releases its command process before its next process starts. */
  releaseHandle(): void {
    this.currentHandle = null;
  }

  consumeOutput(data: Uint8Array): void {
    if (!this.disposed) this.titleTracker.consume(data);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.titleTracker.dispose();
    this.currentHandle = null;
  }
}

type TerminalSessionInput = {
  summary: TerminalSummary;
  titleTracker: TerminalTitleTracker;
  operations: SerialLane;
  replayByteLimit: number;
  shell: string;
  grid: TerminalGrid;
  /** The activity command. A command terminal shows its command lines until the command ends. */
  command: string | null;
  commandRun: TerminalCommandRun | null;
};

export const createTerminalSession = (input: TerminalSessionInput): TerminalSession => {
  const screen = new TerminalScreenState(input.grid);
  return {
    summary: input.summary,
    output: new TerminalSessionOutput(input.summary.terminalId, input.replayByteLimit, () =>
      screen.snapshot(),
    ),
    screen,
    screenReleaseStarted: false,
    operations: input.operations,
    grid: input.grid,
    shell: input.shell,
    command: input.command,
    commandRun: input.commandRun,
    resources: new TerminalSessionResources(input.titleTracker),
  };
};

export const copyTerminalSummary = (session: TerminalSession): TerminalSummary => ({
  ...session.summary,
  context: { ...session.summary.context },
});

export const isLiveTerminal = (session: TerminalSession): boolean =>
  session.summary.lifecycle === "starting" ||
  session.summary.lifecycle === "running" ||
  session.summary.lifecycle === "closing" ||
  session.summary.lifecycle === "close_failed";

export const isCommandRunning = (session: TerminalSession): boolean =>
  session.commandRun?.phase === "command" && isLiveTerminal(session);

/** Settles the command result once. Call it after queued output is parsed, before the screen is released. */
export const settleCommandRun = (
  session: TerminalSession,
  result: (outputTail: readonly string[]) => TerminalCommandResult,
): void => {
  const run = session.commandRun;
  if (!run || Deferred.isDoneUnsafe(run.result)) return;
  const outputTail = session.screen.outputTail(TERMINAL_LIMITS.commandOutputTailLines);
  Deferred.doneUnsafe(run.result, Effect.succeed(result(outputTail)));
};

/** Settles the command result after the screen parses the queued output. */
export const settleCommandRunAfterOutput = (
  session: TerminalSession,
  result: (outputTail: readonly string[]) => TerminalCommandResult,
): void => {
  const run = session.commandRun;
  if (!run || Deferred.isDoneUnsafe(run.result)) return;
  void session.screen.drained().then(() => settleCommandRun(session, result));
};

export const activateTerminalSession = (
  session: TerminalSession,
  handle: TerminalPtyHandle,
): boolean => {
  if (session.summary.lifecycle !== "starting" || !session.resources.activate(handle)) return false;
  session.summary.lifecycle = "running";
  return true;
};

export const beginTerminalClose = (session: TerminalSession): void => {
  session.summary.lifecycle = "closing";
};

export const markTerminalCloseFailed = (session: TerminalSession): void => {
  session.summary.lifecycle = "close_failed";
};

export const markTerminalOverflowed = (session: TerminalSession): boolean => {
  return session.output.markOverflowed();
};

export const forgetTerminalSession = (session: TerminalSession): void => {
  session.resources.dispose();
  if (session.screenReleaseStarted) return;
  session.screenReleaseStarted = true;
  void session.screen.drained().then(() => {
    settleCommandRun(session, closedResult);
    session.screen.dispose();
  });
};

export const exitTerminalSession = (
  session: TerminalSession,
  {
    exitCode,
    signal,
    exitedAt,
  }: { exitCode: number | null; signal: string | null; exitedAt: string },
): boolean => {
  if (session.summary.lifecycle === "exited") return false;
  session.resources.dispose();
  settleCommandRunAfterOutput(session, closedResult);
  session.summary.lifecycle = "exited";
  session.summary.exit = {
    exitCode,
    signal,
    finalSequence: session.output.nextSequence,
    exitedAt,
  };
  return true;
};

const closedResult = (outputTail: readonly string[]): TerminalCommandResult => ({
  type: "closed",
  outputTail,
});
