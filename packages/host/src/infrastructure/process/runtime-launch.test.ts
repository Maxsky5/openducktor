import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRuntimeLaunch, type NpmShimResolver, readNpmShim } from "./runtime-launch";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

const createShim = (segments: string[], content: string): string => {
  root ||= realpathSync(mkdtempSync(path.join(tmpdir(), "odt-runtime-launch-")));
  const file = path.join(root, ...segments);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
};

const RUNTIME_SHIM = String.raw`"%dp0%\node_modules\runtime\bin\runtime.exe" %*`;

/** Resolves every shim that runs the test package to one binary. */
const resolveRuntime: NpmShimResolver = (shim, env) =>
  shim.runs("\\runtime\\bin\\runtime.exe") ? { executablePath: "C:/runtime.exe", env } : null;

describe("readNpmShim", () => {
  test("reads the package folders of a global and a local shim", () => {
    const global = readNpmShim(createShim(["npm", "runtime.cmd"], RUNTIME_SHIM));
    expect(global.moduleRoots).toEqual([path.join(root, "npm", "node_modules")]);
    expect(global.runs("\\RUNTIME\\bin\\runtime.exe")).toBe(true);
    const local = readNpmShim(createShim(["app", "node_modules", ".bin", "runtime.cmd"], ""));
    expect(local.moduleRoots).toEqual([
      path.join(root, "app", "node_modules", ".bin", "node_modules"),
      path.join(root, "app", "node_modules"),
    ]);
  });
});

describe("createRuntimeLaunch", () => {
  test("tracks a direct executable as the runtime", () => {
    expect(
      createRuntimeLaunch("/usr/bin/codex", ["app-server"], {}, "linux", resolveRuntime),
    ).toMatchObject({
      command: "/usr/bin/codex",
      args: ["app-server"],
      usesCommandShell: false,
      managed: { kind: "runtime" },
    });
  });

  test("tracks an unknown batch launcher as a runtime launcher", () => {
    const launcher = createShim(["tools", "runtime.cmd"], "@echo off");
    expect(createRuntimeLaunch(launcher, [], {}, "win32", resolveRuntime)).toMatchObject({
      usesCommandShell: true,
      managed: { kind: "runtime_launcher" },
    });
  });

  test("starts the binary behind a known npm shim as the runtime", () => {
    const shim = createShim(["npm", "runtime.cmd"], RUNTIME_SHIM);
    expect(createRuntimeLaunch(shim, ["serve"], {}, "win32", resolveRuntime)).toMatchObject({
      command: "C:/runtime.exe",
      args: ["serve"],
      usesCommandShell: false,
      managed: { kind: "runtime" },
    });
  });

  test("reads only a batch launcher as a shim", () => {
    const executable = createShim(["npm", "runtime.exe"], RUNTIME_SHIM);
    expect(createRuntimeLaunch(executable, [], {}, "win32", resolveRuntime).command).toBe(
      executable,
    );
  });
});
