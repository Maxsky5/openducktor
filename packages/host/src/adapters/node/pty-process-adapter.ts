import { Buffer } from "node:buffer";
import {
  type ProcessTreeInspector,
  type ProcessTreeTerminator,
  processTreeHasChildren,
  processTreeIsAlive,
  terminateProcessTree,
  waitForObservedState,
} from "../../infrastructure/process/process-tree";
import {
  TerminalPtyError,
  type TerminalPtyHandle,
  type TerminalPtyPort,
} from "../../ports/terminal-pty-port";
import { Effect } from "effect";
import { spawn } from "node-pty";

type NodePtyProcess = Pick<
  ReturnType<typeof spawn>,
  "pid" | "onExit" | "write" | "resize" | "pause" | "resume"
> & {
  onData(listener: (value: string | Buffer) => void): { dispose(): void };
};

type NodePtyModule = {
  readonly spawn: (...args: Parameters<typeof spawn>) => NodePtyProcess;
};

type CreateNodePtyPortInput = {
  nodePty?: NodePtyModule;
  processTreeInspector?: ProcessTreeInspector;
  processTreeTerminator?: ProcessTreeTerminator;
};

const operation = (
  name: TerminalPtyError["operation"],
  run: () => void,
): Effect.Effect<void, TerminalPtyError> =>
  Effect.try({
    try: run,
    catch: (cause) =>
      new TerminalPtyError({
        code: "operation_failed",
        operation: name,
        message: `node-pty ${name} failed.`,
        cause,
      }),
  });

export const createNodePtyPort = ({
  nodePty = { spawn },
  processTreeInspector = processTreeHasChildren,
  processTreeTerminator = terminateProcessTree,
}: CreateNodePtyPortInput = {}): TerminalPtyPort => ({
  start: (plan, handlers) =>
    Effect.try({
      try: () => {
        let closed = false;
        const exitWaiters = new Set<() => void>();
        let exitPublished = false;
        type NativeExit = { exitCode: number; signal: string | null };
        let nativeExit: NativeExit | null = null;
        let receivedOutput = false;
        let cleanupPromise: Promise<void> | null = null;
        let terminating = false;
        let terminated = false;
        let outputPaused = false;
        const terminationPermit = Effect.unsafeMakeSemaphore(1);
        const pty = nodePty.spawn(plan.shell, [...plan.args], {
          cols: plan.grid.columns,
          cwd: plan.cwd,
          encoding: null,
          env: plan.env,
          name: "xterm-256color",
          rows: plan.grid.rows,
        });
        const dataSubscription = pty.onData((value) => {
          // Windows node-pty decodes its ConPTY socket as UTF-8 even with encoding: null.
          const data = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
          receivedOutput ||= data.byteLength > 0;
          handlers.onOutput(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
        });
        const exitSubscription = pty.onExit(({ exitCode, signal }) => {
          if (closed) return;
          closed = true;
          nativeExit = { exitCode, signal: signal === undefined ? null : String(signal) };
          if (!receivedOutput && (exitCode !== 0 || Boolean(signal)) && !cleanupPromise) {
            handlers.onFailure(
              new TerminalPtyError({
                code: "spawn_failed",
                operation: "start",
                message: `Terminal shell ${plan.shell} exited with code ${exitCode}${signal ? ` (signal ${signal})` : ""} before producing output in ${plan.cwd}. Check that the shell starts in this directory outside OpenDucktor.`,
              }),
            );
          }
          for (const waiter of exitWaiters) waiter();
          Effect.runFork(
            finalizeExit().pipe(
              Effect.tapError((failure) => Effect.sync(() => handlers.onFailure(failure))),
            ),
          );
        });
        const processTreeClosed = (): boolean =>
          closed && !processTreeIsAlive(pty.pid, process.platform);
        const waitForExit = (timeoutMs: number): Effect.Effect<boolean> =>
          waitForObservedState({
            isComplete: processTreeClosed,
            subscribe: (listener) => {
              exitWaiters.add(listener);
              return () => exitWaiters.delete(listener);
            },
            timeoutMs,
          });
        const terminateProcessTreeEffect = () =>
          processTreeTerminator({
            pid: pty.pid,
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
                  message: "node-pty process-tree termination failed.",
                  cause,
                }),
            ),
          );
        const ensureProcessTreeTerminated = (): Effect.Effect<void, TerminalPtyError> =>
          Effect.tryPromise({
            try: () => {
              cleanupPromise ??= Promise.resolve()
                .then(() => Effect.runPromise(terminateProcessTreeEffect()))
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
                message: "node-pty process-tree termination failed.",
                cause,
              }),
          });
        const publishExit = (): void => {
          if (exitPublished || !nativeExit) return;
          exitPublished = true;
          dataSubscription.dispose();
          exitSubscription.dispose();
          handlers.onExit(nativeExit);
        };
        const finalizeExit = (): Effect.Effect<void, TerminalPtyError> =>
          // node-pty releases ConPTY before reporting a connection failure with no process ID.
          closed && pty.pid === 0
            ? Effect.sync(publishExit)
            : ensureProcessTreeTerminated().pipe(Effect.tap(() => Effect.sync(publishExit)));
        const requireOpen = (name: TerminalPtyError["operation"], run: () => void) =>
          operation(name, () => {
            if (closed) throw new Error("The terminal is already closed.");
            run();
          });
        const requireInteractive = (name: "write" | "resize", run: () => void) =>
          Effect.suspend(() =>
            terminating || terminated
              ? Effect.fail(
                  new TerminalPtyError({
                    code: "operation_failed",
                    operation: name,
                    message: "Terminal is closing. Wait for close to finish or retry if it fails.",
                  }),
                )
              : requireOpen(name, run),
          );
        const handle: TerminalPtyHandle = {
          supportsOutputPause: true,
          hasChildProcesses: () =>
            processTreeInspector(pty.pid).pipe(
              Effect.mapError(
                (cause) =>
                  new TerminalPtyError({
                    code: "operation_failed",
                    operation: "inspect",
                    message: "node-pty child-process inspection failed.",
                    cause,
                  }),
              ),
            ),
          write: (data) => requireInteractive("write", () => pty.write(Buffer.from(data))),
          resize: ({ columns, rows }) =>
            requireInteractive("resize", () => pty.resize(columns, rows)),
          pauseOutput: () =>
            Effect.suspend(() =>
              terminating
                ? Effect.sync(() => {
                    outputPaused = true;
                  })
                : requireOpen("pause", () => {
                    pty.pause();
                    outputPaused = true;
                  }),
            ),
          resumeOutput: () =>
            Effect.suspend(() =>
              terminating
                ? Effect.sync(() => {
                    outputPaused = false;
                  })
                : requireOpen("resume", () => {
                    pty.resume();
                    outputPaused = false;
                  }),
            ),
          terminate: () =>
            terminationPermit.withPermits(1)(
              Effect.gen(function* () {
                if (exitPublished || terminated) return;
                terminating = true;
                const result = yield* Effect.either(
                  Effect.gen(function* () {
                    // node-pty delays onExit until its output stream closes.
                    if (!closed) yield* operation("terminate", () => pty.resume());
                    yield* finalizeExit();
                  }),
                );
                if (result._tag === "Right") {
                  terminating = false;
                  terminated = true;
                  return;
                }

                const restore = yield* Effect.either(
                  operation("terminate", () => {
                    if (!closed && outputPaused) pty.pause();
                  }),
                );
                terminating = false;
                if (restore._tag === "Left") {
                  return yield* Effect.fail(
                    new TerminalPtyError({
                      code: "operation_failed",
                      operation: "terminate",
                      message: "node-pty could not restore output pause after termination failed.",
                      cause: new AggregateError([result.left, restore.left]),
                    }),
                  );
                }
                return yield* Effect.fail(result.left);
              }),
            ),
        };
        return handle;
      },
      catch: (cause) =>
        new TerminalPtyError({
          code: "spawn_failed",
          operation: "start",
          message: `Could not start terminal shell ${plan.shell} in ${plan.cwd}: ${cause instanceof Error ? cause.message : String(cause)}. Check that the shell executable and working directory are accessible.`,
          cause,
        }),
    }),
});
