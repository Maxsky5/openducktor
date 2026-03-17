import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandEnvOverrideName,
  resolveBundledCommandPath,
  resolveCommandExecutable,
} from "./beads-runtime";

const originalExecPath = process.execPath;

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
});

describe("beads runtime command resolution", () => {
  test("resolveBundledCommandPath uses sibling executable next to current binary", () => {
    const root = mkdtempSync(join(tmpdir(), "odt-mcp-bundled-"));
    const executableDir = join(root, "MacOS");
    mkdirSync(executableDir, { recursive: true });
    const fakeExecPath = join(executableDir, "openducktor-mcp");
    const fakeBdPath = join(executableDir, "bd");
    writeFileSync(fakeExecPath, "");
    writeFileSync(fakeBdPath, "");
    setExecPath(fakeExecPath);

    expect(resolveBundledCommandPath("bd")).toBe(fakeBdPath);

    rmSync(root, { recursive: true, force: true });
  });

  test("resolveCommandExecutable prefers explicit override", () => {
    const root = mkdtempSync(join(tmpdir(), "odt-mcp-override-"));
    const binaryPath = join(root, "bd-override");
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
    process.env[commandEnvOverrideName("bd")] = binaryPath;

    expect(resolveCommandExecutable("bd")).toBe(binaryPath);

    rmSync(root, { recursive: true, force: true });
  });

  test("resolveCommandExecutable rejects invalid explicit override", () => {
    process.env[commandEnvOverrideName("bd")] = "/tmp/odt-missing-bd-override";

    expect(() => resolveCommandExecutable("bd")).toThrow(
      "Configured command override OPENDUCKTOR_BD_PATH points to a missing file",
    );
  });
});
