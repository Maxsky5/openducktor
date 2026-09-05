import { Buffer } from "node:buffer";
import {
  type ProcessTreeInspector,
  type ProcessTreeTerminator,
  processTreeHasChildren,
  processTreeIsAlive,
  TerminalPtyError,
  type TerminalPtyHandle,
  type TerminalPtyPort,
  terminateProcessTree,
  waitForObservedState,
} from "@openducktor/host";
import { Effect } from "effect";
import { spawn } from "node-pty";

type NodePtyModule = { readonly spawn: typeof spawn };

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
          write: (data) => requireOpen("write", () => pty.write(Buffer.from(data))),
          resize: ({ columns, rows }) => requireOpen("resize", () => pty.resize(columns, rows)),
          pauseOutput: () => requireOpen("pause", () => pty.pause()),
          resumeOutput: () => requireOpen("resume", () => pty.resume()),
          terminate: () => (exitPublished ? Effect.void : finalizeExit()),
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
