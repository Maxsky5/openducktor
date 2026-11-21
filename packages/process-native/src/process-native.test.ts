import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProcessNative } from "../scripts/build-native";
import { loadProcessNative, workspaceProcessNativeDirectory } from "./index";

// The tests load the real module, so Cargo builds it first. Cargo skips the work when the build is current.
buildProcessNative();
const native = loadProcessNative(workspaceProcessNativeDirectory());
const directories: string[] = [];
const children: Bun.Subprocess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const startServer = async () => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "odt-process-native-")));
  directories.push(directory);
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      "require('node:http').createServer(() => {}).listen(0, '127.0.0.1', function () { console.log(this.address().port) })",
    ],
    { cwd: directory, stdout: "pipe" },
  );
  children.push(child);
  const reader = child.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const port = Number(new TextDecoder().decode(value).trim());
  const listed = (await native.listProcesses()).find((entry) => entry.pid === child.pid);
  if (!listed) throw new Error("The test server is missing from the process list.");
  return { child, directory, port, listed };
};

describe("process native module", () => {
  test("lists a process with its directory and listener", async () => {
    const { child, directory, port, listed } = await startServer();

    expect(listed.cwd).toBe(directory);
    expect(listed.identity).toMatch(/^[1-9][0-9]*$/);
    expect(listed.executable).toBeString();

    const [inspection] = await native.inspectProcesses([
      { pid: child.pid, identity: listed.identity },
    ]);
    expect(inspection).toMatchObject({ live: true, canStop: true });
    expect(inspection?.listeners).toContainEqual({ address: "127.0.0.1", port });
  });

  test("stops the same instance and reports an exited one", async () => {
    const { child, directory, listed } = await startServer();
    const request = {
      pid: child.pid,
      identity: listed.identity,
      evidenceKind: "cwd" as const,
      evidencePath: directory,
      timeoutMs: 3000,
      allowPidSignal: native.stopMode() === "pid",
    };

    expect(await native.stopProcess({ ...request, evidencePath: tmpdir() })).toMatchObject({
      kind: "changed",
    });
    expect(await native.stopProcess({ ...request, identity: "1" })).toMatchObject({
      kind: "already_exited",
    });
    expect(await native.stopProcess(request)).toMatchObject({ kind: "stopped" });
    await child.exited;
    expect(await native.stopProcess(request)).toMatchObject({ kind: "already_exited" });
    const [inspection] = await native.inspectProcesses([
      { pid: child.pid, identity: listed.identity },
    ]);
    expect(inspection?.live).toBe(false);
  });
});

describe("process native module input", () => {
  test("tells a stdio channel from a null input", async () => {
    const piped = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdin: "pipe",
    });
    const ignored = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdin: "ignore",
    });
    children.push(piped, ignored);
    const listed = await native.listProcesses();
    const target = (pid: number) => {
      const entry = listed.find((process) => process.pid === pid);
      if (!entry) throw new Error(`Process ${pid} is missing from the process list.`);
      return { pid, identity: entry.identity };
    };
    const [pipedInput, ignoredInput] = await native.readStandardInputs([
      target(piped.pid),
      target(ignored.pid),
    ]);
    expect(pipedInput).toMatchObject({ live: true, kind: "pipe" });
    expect(ignoredInput).toMatchObject({ live: true, kind: "other" });
    // On Windows, the host can tell which process serves the pipe.
    if (process.platform === "win32") {
      expect(pipedInput?.serverPid).toBe(process.pid);
      expect(ignoredInput?.serverPid).toBeUndefined();
    }
  });
});
