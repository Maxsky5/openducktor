import { spawn } from "node:child_process";
import { Effect } from "effect";
import {
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import {
  type DevServerProcessExit,
  type DevServerProcessPort,
  DevServerProcessStartExitError,
  type DevServerProcessStartInput,
} from "../../ports/dev-server-process-port";
import { shouldStartDetachedProcessGroup, terminateProcessTree } from "../process/process-tree";

export type CreateDevServerProcessAdapterInput = {
  processEnv?: NodeJS.ProcessEnv;
  startGracePeriodMs?: number;
  stopTimeoutMs?: number;
};

const DEFAULT_START_GRACE_PERIOD_MS = 150;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

export const createDevServerProcessAdapter = ({
  processEnv = process.env,
  startGracePeriodMs = DEFAULT_START_GRACE_PERIOD_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
}: CreateDevServerProcessAdapterInput = {}): DevServerProcessPort => ({
  start(input: DevServerProcessStartInput) {
    return Effect.tryPromise({
      try: async () => {
        const { command, cwd, env, onExit, onOutput } = input;
        if (command.trim().length === 0) {
          throw new HostValidationError({
            message: "Dev server command is empty. Provide a command to run.",
            field: "command",
          });
        }

        const child = spawn(command, {
          cwd,
          detached: shouldStartDetachedProcessGroup(),
          env: { ...processEnv, ...env },
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const pid = child.pid;
        if (!pid || pid <= 0) {
          throw new HostOperationError({
            message: "Failed to start dev server: child process did not expose a valid pid.",
            operation: "dev-server.start",
          });
        }

        let started = false;
        let closeResult: DevServerProcessExit | null = null;
        let spawnError: Error | null = null;
        const closeListeners = new Set<() => void>();

        const notifyCloseListeners = (): void => {
          for (const listener of closeListeners) {
            listener();
          }
        };
        const waitForClose = async (timeoutMs: number): Promise<boolean> => {
          if (closeResult !== null || spawnError !== null) {
            return true;
          }

          return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
              closeListeners.delete(resolveTrue);
              resolve(false);
            }, timeoutMs);
            const resolveTrue = () => {
              clearTimeout(timeout);
              closeListeners.delete(resolveTrue);
              resolve(true);
            };
            closeListeners.add(resolveTrue);
          });
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          onOutput({ data: chunk.toString("utf8") });
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          onOutput({ data: chunk.toString("utf8") });
        });
        child.once("error", (error) => {
          spawnError = error;
          notifyCloseListeners();
          if (started) {
            onExit({
              pid,
              exitCode: null,
              signal: null,
              error: error.message,
            });
          }
        });
        child.once("close", (exitCode, signal) => {
          closeResult = {
            pid,
            exitCode,
            signal,
            error: null,
          };
          notifyCloseListeners();
          if (started) {
            onExit(closeResult);
          }
        });

        const exitedDuringGracePeriod = await waitForClose(startGracePeriodMs);
        if (spawnError) {
          throw spawnError;
        }
        const immediateClose = closeResult as DevServerProcessExit | null;
        if (exitedDuringGracePeriod && immediateClose) {
          throw new DevServerProcessStartExitError(immediateClose.exitCode, immediateClose.signal);
        }

        started = true;

        return {
          pid,
          stop() {
            return Effect.tryPromise({
              try: () =>
                terminateProcessTree({
                  pid,
                  label: `dev server command "${command}"`,
                  isClosed: () => closeResult !== null || spawnError !== null,
                  waitForExit: waitForClose,
                  stopTimeoutMs,
                }),
              catch: (cause) => toHostOperationError(cause, "devServerProcess.stop"),
            });
          },
        };
      },
      catch: (cause) => toHostOperationError(cause, "devServerProcess.start"),
    });
  },
});
