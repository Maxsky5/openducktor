import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const windowsTest = process.platform === "win32" ? test : test.skip;

windowsTest(
  "PowerShell installs, updates, and restores a fixture NSIS release",
  () => {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-File", join(import.meta.dir, "install-powershell.test.ps1")],
      { encoding: "utf8", timeout: 25_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PowerShell installer fixtures passed.");
  },
  30_000,
);
