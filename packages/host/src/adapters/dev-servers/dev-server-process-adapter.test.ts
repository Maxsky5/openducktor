import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDirectory } from "../../test-support/temp-directory";
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

const createShellScriptCommand = async (
  root: string,
  name: string,
  content: string,
): Promise<string> => {
  const scriptPath = join(root, process.platform === "win32" ? `${name}.cmd` : name);
  await writeFile(scriptPath, content);
  await chmod(scriptPath, 0o755);
  return quoteShellArg(scriptPath);
};

describe("createDevServerProcessAdapter", () => {
  test("starts a shell command, streams output, and stops the process group", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-dev-server-adapter-"));
    const outputs: string[] = [];
    const exits: unknown[] = [];
    const port = createDevServerProcessAdapter({
      startGracePeriodMs: 20,
      stopTimeoutMs: 200,
    });

    try {
      const command = await createShellScriptCommand(
        root,
        "dev-server",
        process.platform === "win32"
          ? "@echo off\r\n<nul set /p=ready\r\nping -n 6 127.0.0.1 >nul\r\n"
          : "#!/bin/sh\nprintf ready\nsleep 5\n",
      );

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
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("rejects commands that exit during the start grace period", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-dev-server-adapter-exit-"));
    const port = createDevServerProcessAdapter({
      startGracePeriodMs: 1_000,
      stopTimeoutMs: 100,
    });

    try {
      const command = await createShellScriptCommand(
        root,
        "exit-server",
        process.platform === "win32" ? "@exit /b 42\r\n" : "#!/bin/sh\nexit 42\n",
      );

      await expect(
        port.start({
          command,
          cwd: process.cwd(),
          onExit: () => {},
          onOutput: () => {},
        }),
      ).rejects.toThrow("Dev server exited with code 42.");
    } finally {
      await removeTestDirectory(root);
    }
  });
});
