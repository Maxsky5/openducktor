import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { TerminalPtyError, type TerminalPtyHandle, type TerminalPtyPort } from "@openducktor/host";
import { Effect } from "effect";
import type * as NodePty from "node-pty";

type NodePtyModule = Pick<typeof NodePty, "spawn">;

type CreateNodePtyPortInput = {
  nodePty?: NodePtyModule;
};

const loadNodePty = (): NodePtyModule => {
  const require = createRequire(import.meta.url);
  return require("node-pty") as NodePtyModule;
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
  nodePty = loadNodePty(),
}: CreateNodePtyPortInput = {}): TerminalPtyPort => ({
  start: (plan, handlers) =>
    Effect.try({
      try: () => {
        let closed = false;
        const pty = nodePty.spawn(plan.shell, [...plan.args], {
          cols: plan.grid.columns,
          cwd: plan.cwd,
          encoding: null,
          env: plan.env,
          name: "xterm-256color",
          rows: plan.grid.rows,
        });
        const dataSubscription = pty.onData((value) => {
          if (!Buffer.isBuffer(value)) {
            dataSubscription.dispose();
            handlers.onFailure(
              new TerminalPtyError({
                code: "operation_failed",
                operation: "start",
                message: "node-pty emitted text despite raw-buffer mode.",
              }),
            );
            pty.kill();
            return;
          }
          handlers.onOutput(
            new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
          );
        });
        const exitSubscription = pty.onExit(({ exitCode, signal }) => {
          if (closed) return;
          closed = true;
          dataSubscription.dispose();
          exitSubscription.dispose();
          handlers.onExit({
            exitCode,
            signal: signal === undefined ? null : String(signal),
          });
        });
        const requireOpen = (name: TerminalPtyError["operation"], run: () => void) =>
          operation(name, () => {
            if (closed) throw new Error("The terminal is already closed.");
            run();
          });
        const handle: TerminalPtyHandle = {
          supportsOutputPause: true,
          write: (data) => requireOpen("write", () => pty.write(Buffer.from(data))),
          resize: ({ columns, rows }) => requireOpen("resize", () => pty.resize(columns, rows)),
          pauseOutput: () => requireOpen("pause", () => pty.pause()),
          resumeOutput: () => requireOpen("resume", () => pty.resume()),
          terminate: () =>
            operation("terminate", () => {
              if (closed) return;
              pty.kill();
              closed = true;
              dataSubscription.dispose();
              exitSubscription.dispose();
            }),
        };
        return handle;
      },
      catch: (cause) =>
        new TerminalPtyError({
          code: "spawn_failed",
          operation: "start",
          message: `node-pty could not start ${plan.shell}.`,
          cause,
        }),
    }),
});
