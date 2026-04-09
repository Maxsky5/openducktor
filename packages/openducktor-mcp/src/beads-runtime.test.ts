import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  bundledCommandCandidates,
  commandEnvOverrideName,
  computeBeadsDatabaseName,
  resolveBundledCommandPath,
  resolveCommandExecutable,
  resolveRepoBeadsAttachmentDir,
  sanitizeSlug,
} from "./beads-runtime";

const originalExecPath = process.execPath;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalConfigRoot = process.env.OPENDUCKTOR_CONFIG_DIR;
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
  if (typeof originalHome === "string") {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
  if (typeof originalUserProfile === "string") {
    process.env.USERPROFILE = originalUserProfile;
  } else {
    delete process.env.USERPROFILE;
  }
  if (typeof originalConfigRoot === "string") {
    process.env.OPENDUCKTOR_CONFIG_DIR = originalConfigRoot;
  } else {
    delete process.env.OPENDUCKTOR_CONFIG_DIR;
  }
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

  test("resolveCommandExecutable expands home shorthand in explicit override", () => {
    const subdirName = `.odt-mcp-home-override-${Date.now()}`;
    const root = join(homedir(), subdirName);
    tempDirs.push(root);
    mkdirSync(root, { recursive: true });
    const binaryPath = join(root, "bd-override");
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
    process.env[commandEnvOverrideName("bd")] = `~/${subdirName}/bd-override`;

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

  test("sanitizeSlug matches the Rust ASCII-only behavior", () => {
    expect(sanitizeSlug("İstanbul")).toBe("stanbul");
    expect(sanitizeSlug("___My Repo___")).toBe("my-repo");
  });

  test("computeBeadsDatabaseName is stable for the same repo path", async () => {
    const first = await computeBeadsDatabaseName("/tmp/OpenDucktor Repo");
    const firstAgain = await computeBeadsDatabaseName("/tmp/OpenDucktor Repo");
    const second = await computeBeadsDatabaseName("/tmp/b/project");

    expect(firstAgain).toBe(first);
    expect(first).toBe("odt_openducktor_repo_d03d54c7be05");
    expect(second).toBe("odt_project_11c79766e587");
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(64);
  });

  test("computeBeadsDatabaseName differs for same-basename repos in different paths", async () => {
    const first = await computeBeadsDatabaseName("/tmp/a/project");
    const second = await computeBeadsDatabaseName("/tmp/b/project");

    expect(first).toBe("odt_project_ee5494991388");
    expect(second).toBe("odt_project_11c79766e587");
  });

  test("resolveRepoBeadsAttachmentDir uses the shared config root layout", async () => {
    process.env.OPENDUCKTOR_CONFIG_DIR = "/tmp/odt-config-root";
    const attachmentDir = await resolveRepoBeadsAttachmentDir("/tmp/openducktor-test/repo");

    expect(attachmentDir).toMatch(/^\/tmp\/odt-config-root\/beads\/repo-[a-f0-9]{8}\/\.beads$/);
  });
});
