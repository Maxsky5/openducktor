import type { TerminalSummary } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { TerminalPtyHandle } from "../../ports/terminal-pty-port";
import type { TerminalGrid } from "../../ports/terminal-pty-port";
import { TerminalScreenState } from "./terminal-screen-state";
import { TerminalSessionOutput } from "./terminal-session-output";
import type { TerminalTitleTracker } from "./terminal-title-tracker";

export type TerminalSession = {
  summary: TerminalSummary;
  resources: TerminalSessionResources;
  output: TerminalSessionOutput;
  screen: TerminalScreenState;
  operations: Effect.Semaphore;
};

class TerminalSessionResources {
  private currentHandle: TerminalPtyHandle | null = null;
  private disposed = false;

  constructor(
    readonly shell: string,
    private readonly titleTracker: TerminalTitleTracker,
  ) {}

  get handle(): TerminalPtyHandle | null {
    return this.currentHandle;
  }

  activate(handle: TerminalPtyHandle): boolean {
    if (this.disposed) return false;
    this.currentHandle = handle;
    return true;
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

export const createTerminalSession = ({
  summary,
  titleTracker,
  operations,
  replayByteLimit,
  shell,
  grid,
}: {
  summary: TerminalSummary;
  titleTracker: TerminalTitleTracker;
  operations: Effect.Semaphore;
  replayByteLimit: number;
  shell: string;
  grid: TerminalGrid;
}): TerminalSession => {
  const screen = new TerminalScreenState(grid);
  return {
    summary,
    resources: new TerminalSessionResources(shell, titleTracker),
    output: new TerminalSessionOutput(summary.terminalId, replayByteLimit, () => screen.snapshot()),
    screen,
    operations,
  };
};

export const isLiveTerminal = (session: TerminalSession): boolean =>
  session.summary.lifecycle === "starting" ||
  session.summary.lifecycle === "running" ||
  session.summary.lifecycle === "closing" ||
  session.summary.lifecycle === "close_failed";

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

export const disposeTerminalSession = (session: TerminalSession, releaseScreen = false): void => {
  session.resources.dispose();
  if (releaseScreen) void session.screen.drained().then(() => session.screen.dispose());
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
  disposeTerminalSession(session);
  session.summary.lifecycle = "exited";
  session.summary.exit = {
    exitCode,
    signal,
    finalSequence: session.output.nextSequence,
    exitedAt,
  };
  return true;
};
