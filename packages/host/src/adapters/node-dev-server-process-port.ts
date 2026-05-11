import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  type DevServerProcessExit,
  type DevServerProcessPort,
  DevServerProcessStartExitError,
  type DevServerProcessStartInput,
} from "../ports/dev-server-process-port";

export type CreateNodeDevServerProcessPortInput = {
  startGracePeriodMs?: number;
  stopTimeoutMs?: number;
};

const DEFAULT_START_GRACE_PERIOD_MS = 150;
const DEFAULT_STOP_TIMEOUT_MS = 3_000;

const processGroupId = (pid: number): number => -pid;

const signalProcessGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(processGroupId(pid), signal);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
};

export const createNodeDevServerProcessPort = ({
  startGracePeriodMs = DEFAULT_START_GRACE_PERIOD_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
}: CreateNodeDevServerProcessPortInput = {}): DevServerProcessPort => ({
  async start({ command, cwd, env, onExit, onOutput }: DevServerProcessStartInput) {
    if (process.platform === "win32") {
      throw new Error("Builder dev servers are only supported on Unix hosts in this build.");
    }

    if (command.trim().length === 0) {
      throw new Error("Dev server command is empty. Provide a command to run.");
    }

    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      detached: true,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    if (!pid || pid <= 0) {
      throw new Error("Failed to start dev server: child process did not expose a valid pid.");
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

    const exitedDuringGracePeriod = await Promise.race([
      waitForClose(startGracePeriodMs),
      delay(startGracePeriodMs).then(() => false),
    ]);
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
      async stop() {
        if (closeResult !== null || spawnError !== null) {
          return;
        }

        signalProcessGroup(pid, "SIGTERM");
        if (await waitForClose(stopTimeoutMs)) {
          return;
        }

        signalProcessGroup(pid, "SIGKILL");
        if (await waitForClose(stopTimeoutMs)) {
          return;
        }

        throw new Error(
          `Timed out waiting for process group ${pid} to stop after SIGTERM and SIGKILL`,
        );
      },
    };
  },
});
