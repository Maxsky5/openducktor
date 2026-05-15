import { createDevServerProcessAdapter } from "./dev-server-process-adapter";

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const quoteShellArg = (value: string): string =>
  process.platform === "win32"
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;

describe("createDevServerProcessAdapter", () => {
  test("starts a shell command, streams output, and stops the process group", async () => {
    const outputs: string[] = [];
    const exits: unknown[] = [];
    const port = createDevServerProcessAdapter({
      startGracePeriodMs: 20,
      stopTimeoutMs: 750,
    });
    const command = [
      quoteShellArg(process.execPath),
      "-e",
      quoteShellArg("process.stdout.write('ready'); setInterval(() => {}, 1000);"),
    ].join(" ");

    const handle = await port.start({
      command,
      cwd: process.cwd(),
      onExit: (exit) => exits.push(exit),
      onOutput: (output) => outputs.push(output.data),
    });
    await waitFor(() => outputs.join("").includes("ready"));

    await handle.stop();

    expect(handle.pid).toBeGreaterThan(0);
    expect(outputs.join("")).toContain("ready");
    expect(exits).toEqual([
      expect.objectContaining({
        pid: handle.pid,
      }),
    ]);
  });

  test("rejects commands that exit during the start grace period", async () => {
    const port = createDevServerProcessAdapter({
      startGracePeriodMs: 1_000,
      stopTimeoutMs: 100,
    });
    const command = [
      quoteShellArg(process.execPath),
      "-e",
      quoteShellArg("process.exit(42);"),
    ].join(" ");

    await expect(
      port.start({
        command,
        cwd: process.cwd(),
        onExit: () => {},
        onOutput: () => {},
      }),
    ).rejects.toThrow("Dev server exited with code 42.");
  });
});
