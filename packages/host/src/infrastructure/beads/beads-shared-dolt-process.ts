import { Effect } from "effect";

export const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const processGroupId = (pid: number): number => (process.platform === "win32" ? pid : -pid);

export const signalProcess = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(processGroupId(pid), signal);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
};

export const waitForProcessExit = (pid: number, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!processIsAlive(pid)) {
        return true;
      }
      yield* Effect.sleep("100 millis");
    }
    return !processIsAlive(pid);
  });
