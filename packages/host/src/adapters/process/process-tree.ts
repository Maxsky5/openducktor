import { spawnSync } from "node:child_process";

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const signalProcessTree = (pid: number, signal: NodeJS.Signals): void => {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
    });
    if (result.status === 0 || !processIsAlive(pid)) {
      return;
    }
    throw new Error(`Failed to stop Windows process tree ${pid} with ${signal}.`);
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return;
    }
    if (!processIsAlive(pid)) {
      return;
    }
    throw error;
  }
};

export const shouldStartDetachedProcessGroup = (): boolean => process.platform !== "win32";
