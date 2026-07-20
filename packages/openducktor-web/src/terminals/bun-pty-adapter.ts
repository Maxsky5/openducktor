import {
  type ProcessTreeInspector,
  type ProcessTreeTerminator,
  processTreeHasChildren,
  processTreeIsAlive,
  TerminalPtyError,
  type TerminalPtyExit,
  type TerminalPtyHandle,
  type TerminalPtyHandlers,
  type TerminalPtyLaunchPlan,
  type TerminalPtyPort,
  terminateProcessTree,
  waitForObservedState,
} from "@openducktor/host";
import { Effect } from "effect";

export type BunPtyTerminal = {
  readonly closed: boolean;
  write(data: Uint8Array): number;
  resize(columns: number, rows: number): void;
  close(): void;
};
export type BunPtySubprocess = {
  readonly pid: number;
  readonly terminal?: BunPtyTerminal;
  kill(signal?: NodeJS.Signals | number): void;
};
export type BunPtyTerminalOptions = {
  cols: number;
  rows: number;
  name: string;
  data(terminal: BunPtyTerminal, data: Uint8Array): void;
  exit(terminal: BunPtyTerminal, exitCode: number, signal: string | null): void;
  drain(terminal: BunPtyTerminal): void;
};
export type BunPtySpawnOptions = {
  cwd: string;
  env: Readonly<Record<string, string>>;
  detached: boolean;
  terminal: BunPtyTerminalOptions;
  onExit(
    subprocess: BunPtySubprocess,
    exitCode: number | null,
    signalCode: number | null,
    error?: Error,
  ): void;
};
export type BunPtySpawn = (command: string[], options: BunPtySpawnOptions) => BunPtySubprocess;

type CreateBunPtyPortInput = {
  spawn?: BunPtySpawn;
  platform?: NodeJS.Platform;
  processTreeInspector?: ProcessTreeInspector;
  processTreeTerminator?: ProcessTreeTerminator;
};

type CompletionState = {
  subprocessClosed: boolean;
  terminalEof: boolean;
  exit: TerminalPtyExit | null;
  exitPublished: boolean;
};

type CleanupState =
  | { status: "idle" }
  | { status: "running"; promise: Promise<void> }
  | { status: "complete" };

const unsupported = (): TerminalPtyError =>
  new TerminalPtyError({
    code: "unsupported_runtime",
    operation: "start",
    message: "This Bun runtime does not provide terminal-backed process spawning.",
  });

const operationFailure = (
  operation: TerminalPtyError["operation"],
  message: string,
  cause?: unknown,
): TerminalPtyError =>
  new TerminalPtyError({
    code: "operation_failed",
    operation,
    message,
    ...(cause !== undefined ? { cause } : {}),
  });

class BunPtySession implements TerminalPtyHandle {
  readonly supportsOutputPause = false;
  private subprocess: BunPtySubprocess | null = null;
  private terminal: BunPtyTerminal | null = null;
  private readonly completion: CompletionState = {
    subprocessClosed: false,
    terminalEof: false,
    exit: null,
    exitPublished: false,
  };
  private cleanup: CleanupState = { status: "idle" };
  private termination: "open" | "requested" | "complete" = "open";
  private naturalFinalizationStarted = false;
  private drainGeneration = 0;
  private readonly subprocessExitWaiters = new Set<() => void>();
  private readonly terminalEofWaiters = new Set<() => void>();
  private readonly drainWaiters = new Set<() => void>();

  constructor(
    private readonly handlers: TerminalPtyHandlers,
    private readonly platform: NodeJS.Platform,
    private readonly processTreeInspector: ProcessTreeInspector,
    private readonly processTreeTerminator: ProcessTreeTerminator,
  ) {}

  bind(subprocess: BunPtySubprocess, terminal: BunPtyTerminal): void {
    this.subprocess = subprocess;
    this.terminal = terminal;
    this.startNaturalFinalization();
  }

  onOutput(data: Uint8Array): void {
    this.handlers.onOutput(data.slice());
  }

  onTerminalEof(): void {
    this.completion.terminalEof = true;
    for (const waiter of this.terminalEofWaiters) waiter();
    this.notifyDrain();
    this.startNaturalFinalization();
  }

  onSubprocessExit(exitCode: number | null, signalCode: number | null): void {
    this.completion.subprocessClosed = true;
    this.completion.exit = {
      exitCode,
      signal: signalCode === null ? null : String(signalCode),
    };
    for (const waiter of this.subprocessExitWaiters) waiter();
    this.notifyDrain();
    this.startNaturalFinalization();
  }

  notifyDrain(): void {
    this.drainGeneration += 1;
    for (const waiter of this.drainWaiters) waiter();
  }

  hasChildProcesses = (): Effect.Effect<boolean, TerminalPtyError> =>
    this.processTreeInspector(this.subprocess?.pid ?? 0).pipe(
      Effect.mapError((cause) =>
        operationFailure("inspect", "Bun terminal child-process inspection failed.", cause),
      ),
    );

  write = (data: Uint8Array): Effect.Effect<void, TerminalPtyError> =>
    Effect.gen(this, function* () {
      let offset = 0;
      while (offset < data.byteLength) {
        const generation = this.drainGeneration;
        const remaining = data.subarray(offset);
        const written = yield* this.ensureOpen("write", (terminal) => terminal.write(remaining));
        if (!Number.isInteger(written) || written < 0 || written > remaining.byteLength) {
          return yield* Effect.fail(
            operationFailure("write", "Bun terminal reported an invalid input write length."),
          );
        }
        offset += written;
        if (offset < data.byteLength) yield* this.waitForDrain(generation);
      }
    });

  resize = ({ columns, rows }: { columns: number; rows: number }) =>
    this.ensureOpen("resize", (terminal) => terminal.resize(columns, rows));

  pauseOutput = (): Effect.Effect<void, TerminalPtyError> =>
    Effect.fail(operationFailure("pause", "Bun terminal output pause is unsupported."));

  resumeOutput = (): Effect.Effect<void, TerminalPtyError> =>
    Effect.fail(operationFailure("resume", "Bun terminal output resume is unsupported."));

  terminate = (): Effect.Effect<void, TerminalPtyError> => {
    if (this.termination === "complete") return Effect.void;
    this.termination = "requested";
    return this.finalize(true).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.termination = "complete";
        }),
      ),
    );
  };

  private ensureOpen<Value>(
    operation: TerminalPtyError["operation"],
    run: (terminal: BunPtyTerminal) => Value,
  ): Effect.Effect<Value, TerminalPtyError> {
    return Effect.try({
      try: () => {
        const terminal = this.terminal;
        if (
          !terminal ||
          this.termination !== "open" ||
          this.completion.subprocessClosed ||
          terminal.closed
        ) {
          throw new Error("The terminal is already closed.");
        }
        return run(terminal);
      },
      catch: (cause) => operationFailure(operation, `Bun terminal ${operation} failed.`, cause),
    });
  }

  private processTreeClosed = (): boolean =>
    this.completion.subprocessClosed &&
    !processTreeIsAlive(this.subprocess?.pid ?? 0, this.platform);

  private waitForProcessExit = (timeoutMs: number): Effect.Effect<boolean> =>
    waitForObservedState({
      isComplete: this.processTreeClosed,
      subscribe: (listener) => {
        this.subprocessExitWaiters.add(listener);
        return () => this.subprocessExitWaiters.delete(listener);
      },
      timeoutMs,
    });

  private waitForTerminalEof = (timeoutMs: number): Effect.Effect<boolean> =>
    waitForObservedState({
      isComplete: () => this.completion.terminalEof,
      subscribe: (listener) => {
        this.terminalEofWaiters.add(listener);
        return () => this.terminalEofWaiters.delete(listener);
      },
      timeoutMs,
    });

  private terminateProcessTree(): Effect.Effect<void, TerminalPtyError> {
    return this.processTreeTerminator({
      pid: this.subprocess?.pid ?? 0,
      label: "interactive terminal",
      isClosed: this.processTreeClosed,
      waitForExit: this.waitForProcessExit,
      stopTimeoutMs: 500,
    }).pipe(
      Effect.mapError((cause) =>
        operationFailure("terminate", "Bun terminal process-tree termination failed.", cause),
      ),
    );
  }

  private ensureProcessTreeTerminated(): Effect.Effect<void, TerminalPtyError> {
    if (this.cleanup.status === "complete") return Effect.void;
    if (this.cleanup.status === "idle") {
      const promise = Effect.runPromise(this.terminateProcessTree()).then(
        () => {
          this.cleanup = { status: "complete" };
        },
        (cause) => {
          this.cleanup = { status: "idle" };
          throw cause;
        },
      );
      this.cleanup = { status: "running", promise };
    }
    const pending = this.cleanup;
    if (pending.status !== "running") return Effect.void;
    return Effect.tryPromise({
      try: () => pending.promise,
      catch: (cause) =>
        operationFailure("terminate", "Bun terminal process-tree termination failed.", cause),
    });
  }

  private closeTerminal(): Effect.Effect<void, TerminalPtyError> {
    return Effect.try({
      try: () => {
        if (this.terminal && !this.terminal.closed) this.terminal.close();
      },
      catch: (cause) => operationFailure("terminate", "Bun terminal close failed.", cause),
    });
  }

  private finalize(closeTerminal: boolean): Effect.Effect<void, TerminalPtyError> {
    if (!this.subprocess) {
      return Effect.fail(operationFailure("terminate", "Bun terminal process id is unavailable."));
    }
    return Effect.gen(this, function* () {
      yield* this.ensureProcessTreeTerminated();
      if (closeTerminal) yield* this.closeTerminal();
      if (!(yield* this.waitForTerminalEof(1_000))) {
        return yield* Effect.fail(
          operationFailure(
            "terminate",
            "Bun terminal did not publish EOF after process-tree termination.",
          ),
        );
      }
      this.publishExit();
    });
  }

  private publishExit(): void {
    if (this.completion.exitPublished || !this.completion.terminalEof || !this.completion.exit) {
      return;
    }
    this.completion.exitPublished = true;
    this.handlers.onExit(this.completion.exit);
  }

  private startNaturalFinalization(): void {
    if (
      !this.subprocess ||
      !this.completion.exit ||
      this.completion.exitPublished ||
      this.naturalFinalizationStarted
    ) {
      return;
    }
    this.naturalFinalizationStarted = true;
    Effect.runFork(
      this.finalize(false).pipe(
        Effect.tapError((failure) => Effect.sync(() => this.handlers.onFailure(failure))),
      ),
    );
  }

  private waitForDrain(generation: number): Effect.Effect<void> {
    if (this.drainGeneration !== generation) return Effect.void;
    return Effect.async<void>((resume, signal) => {
      const finish = (): void => {
        this.drainWaiters.delete(finish);
        signal.removeEventListener("abort", finish);
        resume(Effect.void);
      };
      this.drainWaiters.add(finish);
      signal.addEventListener("abort", finish, { once: true });
      if (this.drainGeneration !== generation) finish();
      return Effect.sync(() => {
        this.drainWaiters.delete(finish);
        signal.removeEventListener("abort", finish);
      });
    });
  }
}

export const createBunPtyPort = ({
  spawn = Bun.spawn as BunPtySpawn,
  platform = process.platform,
  processTreeInspector = processTreeHasChildren,
  processTreeTerminator = terminateProcessTree,
}: CreateBunPtyPortInput = {}): TerminalPtyPort => ({
  start: (plan: TerminalPtyLaunchPlan, handlers: TerminalPtyHandlers) =>
    Effect.try({
      try: (): TerminalPtyHandle => {
        if (typeof Bun.Terminal !== "function") throw unsupported();
        const session = new BunPtySession(
          handlers,
          platform,
          processTreeInspector,
          processTreeTerminator,
        );
        const subprocess = spawn([plan.shell, ...plan.args], {
          cwd: plan.cwd,
          env: plan.env,
          detached: true,
          terminal: {
            cols: plan.grid.columns,
            rows: plan.grid.rows,
            name: "xterm-256color",
            data: (_terminal, data) => session.onOutput(data),
            exit: () => session.onTerminalEof(),
            drain: () => session.notifyDrain(),
          },
          onExit: (_process, exitCode, signalCode) =>
            session.onSubprocessExit(exitCode, signalCode),
        });
        const terminal = subprocess.terminal;
        if (!terminal) {
          subprocess.kill();
          throw unsupported();
        }
        session.bind(subprocess, terminal);
        return session;
      },
      catch: (cause) => {
        if (cause instanceof TerminalPtyError) return cause;
        return new TerminalPtyError({
          code: "spawn_failed",
          operation: "start",
          message: `Bun could not start ${plan.shell} with a terminal.`,
          cause,
        });
      },
    }),
});
