import type { TerminalSummary } from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  TerminalGrid,
  TerminalProducerHandle,
  TerminalPtyHandle,
} from "../../ports/terminal-pty-port";
import { TerminalScreenState } from "./terminal-screen-state";
import { TerminalSessionOutput } from "./terminal-session-output";
import type { TerminalTitleTracker } from "./terminal-title-tracker";

type TerminalSessionState = {
  onForgotten?: () => void;
  summary: TerminalSummary;
  output: TerminalSessionOutput;
  screen: TerminalScreenState;
  screenReleaseStarted: boolean;
  operations: Effect.Semaphore;
};

export type InteractiveTerminalSession = TerminalSessionState & {
  readonly kind: "interactive";
  readonly shell: string;
  resources: TerminalSessionResources<TerminalPtyHandle>;
};

export type OutputTerminalSession = TerminalSessionState & {
  readonly kind: "output";
  resources: TerminalSessionResources<TerminalProducerHandle>;
};

export type TerminalSession = InteractiveTerminalSession | OutputTerminalSession;

class TerminalSessionResources<Handle extends TerminalProducerHandle> {
  private currentHandle: Handle | null = null;
  private disposed = false;

  constructor(private readonly titleTracker: TerminalTitleTracker) {}

  get handle(): Handle | null {
    return this.currentHandle;
  }

  activate(handle: Handle): boolean {
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

type TerminalSessionInput = {
  summary: TerminalSummary;
  titleTracker: TerminalTitleTracker;
  operations: Effect.Semaphore;
  replayByteLimit: number;
  grid: TerminalGrid;
};

export function createTerminalSession(
  input: TerminalSessionInput & { kind: "interactive"; shell: string },
): InteractiveTerminalSession;
export function createTerminalSession(
  input: TerminalSessionInput & { kind: "output" },
): OutputTerminalSession;
export function createTerminalSession(
  input: TerminalSessionInput & ({ kind: "interactive"; shell: string } | { kind: "output" }),
): TerminalSession {
  const screen = new TerminalScreenState(input.grid, input.kind === "output");
  const state: TerminalSessionState = {
    summary: input.summary,
    output: new TerminalSessionOutput(input.summary.terminalId, input.replayByteLimit, () =>
      screen.snapshot(),
    ),
    screen,
    screenReleaseStarted: false,
    operations: input.operations,
  };
  return input.kind === "interactive"
    ? {
        ...state,
        kind: input.kind,
        shell: input.shell,
        resources: new TerminalSessionResources<TerminalPtyHandle>(input.titleTracker),
      }
    : {
        ...state,
        kind: input.kind,
        resources: new TerminalSessionResources<TerminalProducerHandle>(input.titleTracker),
      };
}

export const isLiveTerminal = (session: TerminalSession): boolean =>
  session.summary.lifecycle === "starting" ||
  session.summary.lifecycle === "running" ||
  session.summary.lifecycle === "closing" ||
  session.summary.lifecycle === "close_failed";

export function activateTerminalSession(
  session: InteractiveTerminalSession,
  handle: TerminalPtyHandle,
): boolean;
export function activateTerminalSession(
  session: OutputTerminalSession,
  handle: TerminalProducerHandle,
): boolean;
export function activateTerminalSession<Handle extends TerminalProducerHandle>(
  session: TerminalSessionState & { resources: TerminalSessionResources<Handle> },
  handle: NoInfer<Handle>,
): boolean {
  if (session.summary.lifecycle !== "starting" || !session.resources.activate(handle)) return false;
  session.summary.lifecycle = "running";
  return true;
}

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
  session.onForgotten?.();
  void session.screen.drained().then(() => session.screen.dispose());
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
  session.summary.lifecycle = "exited";
  session.summary.exit = {
    exitCode,
    signal,
    finalSequence: session.output.nextSequence,
    exitedAt,
  };
  return true;
};
