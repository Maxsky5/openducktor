import {
  type ProcessTreeTerminator,
  processTreeIsAlive,
  TerminalPtyError,
  type TerminalPtyHandle,
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
  processTreeTerminator?: ProcessTreeTerminator;
};

const unsupported = (): TerminalPtyError =>
  new TerminalPtyError({
    code: "unsupported_runtime",
    operation: "start",
    message: "This Bun runtime does not provide terminal-backed process spawning.",
  });

export const createBunPtyPort = ({
  spawn = Bun.spawn as BunPtySpawn,
  platform = process.platform,
  processTreeTerminator = terminateProcessTree,
}: CreateBunPtyPortInput = {}): TerminalPtyPort => ({
  start: (plan, handlers) =>
    Effect.try({
      try: () => {
        if (typeof Bun.Terminal !== "function") throw unsupported();
        let subprocessExit: { exitCode: number | null; signal: string | null } | null = null;
        let terminalEof = false;
        let exitPublished = false;
        let subprocess: BunPtySubprocess | null = null;
        let subprocessClosed = false;
        let cleanupPromise: Promise<void> | null = null;
        let cleanupVerified = false;
        let terminationRequested = false;
        let terminationComplete = false;
        let naturalFinalizationStarted = false;
        const subprocessExitWaiters = new Set<() => void>();
        const terminalEofWaiters = new Set<() => void>();
        let startNaturalFinalization = (): void => undefined;
        const publishExit = (): void => {
          if (!exitPublished && terminalEof && subprocessExit) {
            exitPublished = true;
            handlers.onExit(subprocessExit);
          }
        };
        subprocess = spawn([plan.shell, ...plan.args], {
          cwd: plan.cwd,
          env: plan.env,
          detached: true,
          terminal: {
            cols: plan.grid.columns,
            rows: plan.grid.rows,
            name: "xterm-256color",
            data: (_terminal, data) => handlers.onOutput(data.slice()),
            exit: () => {
              terminalEof = true;
              for (const waiter of terminalEofWaiters) waiter();
              startNaturalFinalization();
            },
            drain: () => undefined,
          },
          onExit: (_process, exitCode, signalCode) => {
            subprocessClosed = true;
            for (const waiter of subprocessExitWaiters) waiter();
            subprocessExit = {
              exitCode,
              signal: signalCode === null ? null : String(signalCode),
            };
            startNaturalFinalization();
          },
        });
        const terminal = subprocess.terminal;
        if (!terminal) {
          subprocess.kill();
          throw unsupported();
        }
        const processTreeClosed = (): boolean =>
          subprocessClosed && !processTreeIsAlive(subprocess?.pid ?? 0, platform);
        const waitForExit = (timeoutMs: number): Effect.Effect<boolean> =>
          waitForObservedState({
            isComplete: processTreeClosed,
            subscribe: (listener) => {
              subprocessExitWaiters.add(listener);
              return () => subprocessExitWaiters.delete(listener);
            },
            timeoutMs,
          });
        const waitForTerminalEof = (timeoutMs: number): Effect.Effect<boolean> =>
          waitForObservedState({
            isComplete: () => terminalEof,
            subscribe: (listener) => {
              terminalEofWaiters.add(listener);
              return () => terminalEofWaiters.delete(listener);
            },
            timeoutMs,
          });
        const terminateProcessTreeEffect = () =>
          processTreeTerminator({
            pid: subprocess?.pid ?? 0,
            label: "interactive terminal",
            isClosed: processTreeClosed,
            waitForExit,
            stopTimeoutMs: 500,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new TerminalPtyError({
                  code: "operation_failed",
                  operation: "terminate",
                  message: "Bun terminal process-tree termination failed.",
                  cause,
                }),
            ),
          );
        const ensureProcessTreeTerminated = (): Effect.Effect<void, TerminalPtyError> =>
          Effect.tryPromise({
            try: () => {
              if (cleanupVerified) return Promise.resolve();
              cleanupPromise ??= Promise.resolve()
                .then(() => Effect.runPromise(terminateProcessTreeEffect()))
                .then(() => {
                  cleanupVerified = true;
                })
                .catch((cause) => {
                  cleanupPromise = null;
                  throw cause;
                });
              return cleanupPromise;
            },
            catch: (cause) =>
              new TerminalPtyError({
                code: "operation_failed",
                operation: "terminate",
                message: "Bun terminal process-tree termination failed.",
                cause,
              }),
          });
        const waitForEofAfterCleanup = (): Effect.Effect<void, TerminalPtyError> =>
          Effect.gen(function* () {
            yield* ensureProcessTreeTerminated();
            if (!(yield* waitForTerminalEof(1_000))) {
              return yield* Effect.fail(
                new TerminalPtyError({
                  code: "operation_failed",
                  operation: "terminate",
                  message: "Bun terminal did not publish EOF after process-tree termination.",
                }),
              );
            }
            publishExit();
          });
        const closeTerminal = (): Effect.Effect<void, TerminalPtyError> =>
          Effect.try({
            try: () => {
              if (!terminal.closed) terminal.close();
            },
            catch: (cause) =>
              new TerminalPtyError({
                code: "operation_failed",
                operation: "terminate",
                message: "Bun terminal close failed.",
                cause,
              }),
          });
        const completeTermination = Effect.gen(function* () {
          const pid = subprocess?.pid;
          if (!pid) {
            return yield* Effect.fail(
              new TerminalPtyError({
                code: "operation_failed",
                operation: "terminate",
                message: "Bun terminal process id is unavailable.",
              }),
            );
          }
          yield* ensureProcessTreeTerminated();
          yield* closeTerminal();
          yield* waitForEofAfterCleanup();
        });
        startNaturalFinalization = (): void => {
          if (!subprocessExit || exitPublished || naturalFinalizationStarted) return;
          naturalFinalizationStarted = true;
          Effect.runFork(
            waitForEofAfterCleanup().pipe(
              Effect.tapError((failure) => Effect.sync(() => handlers.onFailure(failure))),
            ),
          );
        };
        const ensureOpen = (operation: TerminalPtyError["operation"], run: () => void) =>
          Effect.try({
            try: () => {
              if (terminationRequested || subprocessClosed || terminal.closed)
                throw new Error("The terminal is already closed.");
              run();
            },
            catch: (cause) =>
              new TerminalPtyError({
                code: "operation_failed",
                operation,
                message: `Bun terminal ${operation} failed.`,
                cause,
              }),
          });
        const handle: TerminalPtyHandle = {
          supportsOutputPause: false,
          write: (data) =>
            ensureOpen("write", () => {
              const written = terminal.write(data);
              if (written !== data.byteLength)
                throw new Error("Bun terminal input backpressure prevented a complete write.");
            }),
          resize: ({ columns, rows }) => ensureOpen("resize", () => terminal.resize(columns, rows)),
          pauseOutput: () =>
            Effect.fail(
              new TerminalPtyError({
                code: "operation_failed",
                operation: "pause",
                message: "Bun terminal output pause is unsupported.",
              }),
            ),
          resumeOutput: () =>
            Effect.fail(
              new TerminalPtyError({
                code: "operation_failed",
                operation: "resume",
                message: "Bun terminal output resume is unsupported.",
              }),
            ),
          terminate: () => {
            terminationRequested = true;
            if (terminationComplete) return Effect.void;
            return completeTermination.pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  terminationComplete = true;
                }),
              ),
            );
          },
        };
        return handle;
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
