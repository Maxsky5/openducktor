import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bundledCommandCandidates,
  commandEnvOverrideName,
  computeBeadsDatabaseName,
  resolveBundledCommandPath,
  resolveCommandExecutable,
} from "./beads-runtime";

const originalExecPath = process.execPath;
const tempDirs: string[] = [];

const setExecPath = (value: string): void => {
  Object.defineProperty(process, "execPath", {
    value,
    configurable: true,
    writable: true,
  });
};

afterEach(() => {
  setExecPath(originalExecPath);
  delete process.env[commandEnvOverrideName("bd")];
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("beads runtime command resolution", () => {
  test("resolveBundledCommandPath uses sibling executable next to current binary", () => {
    const root = mkdtempSync(join(tmpdir(), "odt-mcp-bundled-"));
    tempDirs.push(root);
    const executableDir = join(root, "MacOS");
    mkdirSync(executableDir, { recursive: true });
    const fakeExecPath = join(executableDir, "openducktor-mcp");
    const fakeBdPath = join(executableDir, "bd");
    writeFileSync(fakeExecPath, "");
    writeFileSync(fakeBdPath, "");
    setExecPath(fakeExecPath);

    expect(resolveBundledCommandPath("bd")).toBe(fakeBdPath);
  });

  test("resolveBundledCommandPath checks Windows executable suffixes for bundled sidecars", () => {
    const root = mkdtempSync(join(tmpdir(), "odt-mcp-bundled-win-"));
    tempDirs.push(root);
    const executableDir = join(root, "bin");
    mkdirSync(executableDir, { recursive: true });
    const fakeExecPath = join(executableDir, "openducktor-mcp.exe");
    const fakeBdPath = join(executableDir, "bd.exe");
    writeFileSync(fakeExecPath, "");
    writeFileSync(fakeBdPath, "");

    expect(resolveBundledCommandPath("bd", "win32", ".EXE;.CMD", fakeExecPath)).toBe(fakeBdPath);
    expect(bundledCommandCandidates("bd", "win32", ".EXE;.CMD")).toEqual([
      "bd",
      "bd.exe",
      "bd.cmd",
    ]);
  });

  test("resolveCommandExecutable prefers explicit override", () => {
    const root = mkdtempSync(join(tmpdir(), "odt-mcp-override-"));
    tempDirs.push(root);
    const binaryPath = join(root, "bd-override");
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
    process.env[commandEnvOverrideName("bd")] = binaryPath;

    expect(resolveCommandExecutable("bd")).toBe(binaryPath);
  });

  test("resolveCommandExecutable rejects invalid explicit override", () => {
    process.env[commandEnvOverrideName("bd")] = "/tmp/odt-missing-bd-override";

    expect(() => resolveCommandExecutable("bd")).toThrow(
      "Configured command override OPENDUCKTOR_BD_PATH points to a missing file",
    );
  });

  test("resolveCommandExecutable rejects explicit override directories", () => {
    const root = mkdtempSync(join(tmpdir(), "odt-mcp-override-dir-"));
    tempDirs.push(root);
    process.env[commandEnvOverrideName("bd")] = root;

    expect(() => resolveCommandExecutable("bd")).toThrow(
      "Configured command override OPENDUCKTOR_BD_PATH points to a missing file",
    );
  });

  test("resolveCommandExecutable returns path-containing commands unchanged", () => {
    expect(resolveCommandExecutable("/usr/local/bin/bd")).toBe("/usr/local/bin/bd");
    expect(resolveCommandExecutable("./bd")).toBe("./bd");
  });

  test("bundledCommandCandidates keeps explicit Windows extensions unchanged", () => {
    expect(bundledCommandCandidates("bd.exe", "win32", ".EXE;.CMD")).toEqual(["bd.exe"]);
  });

  test("resolveCommandExecutable falls back to bare command when no bundled path exists", () => {
    const root = mkdtempSync(join(tmpdir(), "odt-mcp-no-bundled-"));
    tempDirs.push(root);
    const executableDir = join(root, "bin");
    mkdirSync(executableDir, { recursive: true });
    const fakeExecPath = join(executableDir, "openducktor-mcp");
    writeFileSync(fakeExecPath, "");
    setExecPath(fakeExecPath);

    expect(resolveCommandExecutable("bd")).toBe("bd");
  });

  test("computeBeadsDatabaseName is stable and scoped to the beads directory", async () => {
    const first = await computeBeadsDatabaseName(
      "/repo/fairnest",
      "/tmp/.openducktor/beads/fairnest/.beads",
    );
    const second = await computeBeadsDatabaseName(
      "/repo/fairnest",
      "/tmp/.openducktor-local/beads/fairnest/.beads",
    );

    expect(first).toMatch(/^odt_fairnest_[a-f0-9]{12}$/);
    expect(second).toMatch(/^odt_fairnest_[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(64);
  });
});
