import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

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

  test("stops a shell command and its long-lived descendant", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-dev-server-tree-"));
    const childPidPath = join(root, "child.pid");
    const readyPath = join(root, "ready");
    const parentPath = join(root, "parent.mjs");
    let childPid: number | null = null;
    await writeFile(
      parentPath,
      `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
  stdio: "ignore",
});
writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
writeFileSync(${JSON.stringify(readyPath)}, "ready");
setInterval(() => {}, 1000);
`,
    );
    const port = createDevServerProcessAdapter({
      startGracePeriodMs: 20,
      stopTimeoutMs: 1_000,
    });
    const command = [quoteShellArg(process.execPath), quoteShellArg(parentPath)].join(" ");

    try {
      const handle = await port.start({
        command,
        cwd: root,
        onExit: () => {},
        onOutput: () => {},
      });
      await waitFor(() => processIsAlive(handle.pid) && existsSync(readyPath), 1_000);
      childPid = Number(await readFile(childPidPath, "utf8"));
      expect(processIsAlive(childPid)).toBe(true);

      await handle.stop();
      await waitFor(() => !processIsAlive(childPid as number), 1_000);
    } finally {
      if (childPid !== null && processIsAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
    }
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
