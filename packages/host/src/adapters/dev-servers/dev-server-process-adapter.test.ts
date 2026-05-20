import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createDevServerProcessAdapter as createEffectDevServerProcessAdapter } from "./dev-server-process-adapter";

const createDevServerProcessAdapter = (
  ...args: Parameters<typeof createEffectDevServerProcessAdapter>
) => {
  const port = createEffectDevServerProcessAdapter(...args);
  return {
    start: async (...startArgs: Parameters<typeof port.start>) => {
      const handle = await Effect.runPromise(port.start(...startArgs));
      return {
        ...handle,
        stop: () => Effect.runPromise(handle.stop()),
      };
    },
  };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const quoteCommandArg = (value: string): string => {
  if (value.length === 0) {
    return `""`;
  }
  if (!/[\s'"]/u.test(value)) {
    return value;
  }
  if (!value.includes(`"`)) {
    return `"${value}"`;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  throw new Error(`Test command argument cannot be represented: ${value}`);
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("createDevServerProcessAdapter", () => {
  test("starts a command, streams stdout and stderr, propagates env, and uses cwd with spaces", async () => {
    const outputs: string[] = [];
    const exits: unknown[] = [];
    const root = await mkdtemp(join(tmpdir(), "odt dev server cwd "));
    const realRoot = await realpath(root);
    const scriptPath = join(root, "server script.mjs");
    await writeFile(
      scriptPath,
      `
process.stdout.write("stdout:" + process.cwd() + ":" + process.env.ODT_PROCESS_ENV_VALUE + ":" + process.env.ODT_START_ENV_VALUE);
process.stderr.write("stderr:ready");
setInterval(() => {}, 1000);
`,
    );
    const port = createDevServerProcessAdapter({
      processEnv: {
        ...process.env,
        ODT_PROCESS_ENV_VALUE: "from-process-env",
      },
      startGracePeriodMs: 20,
      stopTimeoutMs: 750,
    });
    const command = [quoteCommandArg(process.execPath), quoteCommandArg(scriptPath)].join(" ");

    try {
      const handle = await port.start({
        command,
        cwd: root,
        env: {
          ODT_START_ENV_VALUE: "from-start-env",
        },
        onExit: (exit) => exits.push(exit),
        onOutput: (output) => outputs.push(output.data),
      });
      await waitFor(() => outputs.join("").includes("stderr:ready"));

      await handle.stop();

      expect(handle.pid).toBeGreaterThan(0);
      expect(outputs.join("")).toContain(`stdout:${realRoot}:from-process-env:from-start-env`);
      expect(outputs.join("")).toContain("stderr:ready");
      expect(exits).toEqual([
        expect.objectContaining({
          pid: handle.pid,
        }),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("stops a command and its long-lived descendant", async () => {
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
    const command = [quoteCommandArg(process.execPath), quoteCommandArg(parentPath)].join(" ");

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
      quoteCommandArg(process.execPath),
      "-e",
      quoteCommandArg("process.exit(42);"),
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

  test("rejects unmatched command quotes as validation errors", async () => {
    const port = createDevServerProcessAdapter({
      startGracePeriodMs: 20,
      stopTimeoutMs: 100,
    });

    await expect(
      port.start({
        command: `node -e "console.log('ready')`,
        cwd: process.cwd(),
        onExit: () => {},
        onOutput: () => {},
      }),
    ).rejects.toThrow("Dev server command has an unmatched quote.");
  });

  test("runs Windows cmd and bat files with paths containing spaces on native Windows", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "odt dev server scripts "));
    try {
      const scriptDir = join(root, "script dir");
      await mkdir(scriptDir);
      const cmd = join(scriptDir, "start cmd.cmd");
      const bat = join(scriptDir, "start bat.bat");
      await writeFile(cmd, "@echo off\r\necho cmd:%~1:%~2\r\nping -n 60 127.0.0.1 > nul\r\n");
      await writeFile(bat, "@echo off\r\necho bat:%~1:%~2\r\nping -n 60 127.0.0.1 > nul\r\n");

      for (const [script, expected] of [
        [cmd, "cmd:one:two words"],
        [bat, "bat:one:two words"],
      ] as const) {
        const outputs: string[] = [];
        const port = createDevServerProcessAdapter({
          processEnv: { ...process.env, ComSpec: process.env.ComSpec },
          startGracePeriodMs: 100,
          stopTimeoutMs: 1_000,
        });
        const handle = await port.start({
          command: `${quoteCommandArg(script)} one ${quoteCommandArg("two words")}`,
          cwd: root,
          onExit: () => {},
          onOutput: (output) => outputs.push(output.data),
        });
        await waitFor(() => outputs.join("").includes(expected), 1_000);
        await handle.stop();
        expect(outputs.join("")).toContain(expected);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
