import { describe, expect, jest, mock, spyOn, test } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { runWebDev } from "./dev";

const shutdownListenerCounts = () =>
  (["SIGINT", "SIGTERM", "SIGHUP", "exit"] as const).map((signal) => process.listenerCount(signal));

describe("web dev script", () => {
  test.each([
    { color: undefined, expectedColor: "1" },
    { color: "0", expectedColor: "0" },
  ])(
    "starts the CLI with the forwarded arguments and FORCE_COLOR=$expectedColor",
    async ({ color, expectedColor }) => {
      const previousColor = process.env.FORCE_COLOR;
      const kill = mock(() => {});
      // SAFETY: runWebDev uses only the exited promise and kill method of this child process.
      const spawn = spyOn(Bun, "spawn").mockReturnValue({
        exited: Promise.resolve(7),
        kill,
      } as never);
      const listeners = shutdownListenerCounts();
      try {
        if (color === undefined) delete process.env.FORCE_COLOR;
        else process.env.FORCE_COLOR = color;

        expect(await runWebDev(["--port", "1440", "--backend-port", "1441"])).toBe(7);
        expect(spawn).toHaveBeenCalledWith(
          ["node", "dist/cli.js", "--workspace", "--port", "1440", "--backend-port", "1441"],
          expect.objectContaining({
            detached: process.platform !== "win32",
            env: expect.objectContaining({ FORCE_COLOR: expectedColor }),
          }),
        );
        expect(kill).not.toHaveBeenCalled();
        expect(shutdownListenerCounts()).toEqual(listeners);
      } finally {
        if (previousColor === undefined) delete process.env.FORCE_COLOR;
        else process.env.FORCE_COLOR = previousColor;

        spawn.mockRestore();
      }
    },
  );

  test("waits for a slow CLI through repeated shutdown signals before forcing it to exit", async () => {
    jest.useFakeTimers();
    const child = Promise.withResolvers<number>();
    const kill = mock((signal?: NodeJS.Signals | number) => {
      if (signal === 9) child.resolve(137);
    });
    // SAFETY: runWebDev uses only the exited promise and kill method of this child process.
    const spawn = spyOn(Bun, "spawn").mockReturnValue({ exited: child.promise, kill } as never);
    const listeners = shutdownListenerCounts();
    const sigtermListeners = process.listenerCount("SIGTERM");
    const finished = runWebDev([]);
    const stopSignal = process.platform === "win32" ? "SIGTERM" : "SIGINT";

    try {
      process.emit("SIGTERM");
      process.emit("SIGTERM");
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners + 1);
      jest.advanceTimersByTime(29_999);
      expect(kill.mock.calls).toEqual([[stopSignal]]);
      jest.advanceTimersByTime(1);
      await setImmediate();

      expect(kill.mock.calls).toEqual([[stopSignal], [9]]);
      expect(await finished).toBe(143);
      expect(shutdownListenerCounts()).toEqual(listeners);
    } finally {
      child.resolve(0);
      jest.useRealTimers();
      spawn.mockRestore();
      await finished;
    }
  });
});
