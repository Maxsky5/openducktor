import { describe, expect, test } from "bun:test";
import {
  buildWebDevCommand,
  buildWebDevProcessEnvironment,
  keepWebDevProcessAliveDuring,
  resolveWebCliStopSignal,
  shouldDetachWebProcessGroup,
} from "./dev";

describe("web dev script", () => {
  test("launches the workspace CLI with forwarded arguments", () => {
    expect(
      buildWebDevCommand(["--port", "1440", "--backend-port", "1441"], "/usr/local/bin/bun"),
    ).toEqual([
      "/usr/local/bin/bun",
      "src/cli.ts",
      "--workspace",
      "--port",
      "1440",
      "--backend-port",
      "1441",
    ]);
  });

  test("detaches the managed web CLI from terminal signals on Unix platforms", () => {
    expect(shouldDetachWebProcessGroup("darwin")).toBe(true);
    expect(shouldDetachWebProcessGroup("linux")).toBe(true);
    expect(shouldDetachWebProcessGroup("win32")).toBe(false);
  });

  test("uses OpenDucktor-owned shutdown signals for the managed CLI", () => {
    expect(resolveWebCliStopSignal("darwin")).toBe("SIGINT");
    expect(resolveWebCliStopSignal("linux")).toBe("SIGINT");
    expect(resolveWebCliStopSignal("win32")).toBe("SIGTERM");
  });

  test("defaults child process color output while preserving explicit overrides", () => {
    expect(buildWebDevProcessEnvironment({}).FORCE_COLOR).toBe("1");
    expect(buildWebDevProcessEnvironment({ FORCE_COLOR: "0" }).FORCE_COLOR).toBe("0");
  });

  test("keeps the supervisor alive while waiting for the child CLI to stop", async () => {
    let intervalCancelled = false;
    let capturedCallback: (() => void) | null = null;
    let finishOperation: () => void = () => {};
    const operation = new Promise<void>((resolve) => {
      finishOperation = resolve;
    });

    const keepAlivePromise = keepWebDevProcessAliveDuring(operation, {
      scheduleInterval: (callback) => {
        capturedCallback = callback;
        return () => {
          intervalCancelled = true;
        };
      },
    });

    expect(capturedCallback).not.toBeNull();
    expect(intervalCancelled).toBe(false);

    finishOperation();
    await keepAlivePromise;
    expect(intervalCancelled).toBe(true);
  });

  test("uses persistent signal handlers so duplicate wrapper signals do not terminate by default", () => {
    const source = Bun.file(new URL("./dev.ts", import.meta.url)).text();

    return expect(source).resolves.toContain('process.on("SIGTERM"');
  });

  test("tracks child exit state instead of reading a subprocess killed flag", () => {
    const source = Bun.file(new URL("./dev.ts", import.meta.url)).text();

    return expect(source).resolves.not.toContain("webCli.killed");
  });

  test("stops the child CLI from the Effect finalizer when needed", async () => {
    const source = await Bun.file(new URL("./dev.ts", import.meta.url)).text();

    expect(source).toContain("if (cleanupCompleted || webCliExited)");
    expect(source).toContain("keepWebDevProcessAliveDuringEffect(stopWebCliEffect(webCli))");
    expect(source).toContain("force-terminate-timeout");
  });
});
