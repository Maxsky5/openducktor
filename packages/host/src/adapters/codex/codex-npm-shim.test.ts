import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readNpmShim } from "../../infrastructure/process/runtime-launch";
import { resolveCodexNpmShim } from "./codex-npm-shim";

const target = "x86_64-pc-windows-msvc";
// npm writes shims like these. A local shim reaches its package through `..`.
const CODEX_SHIM = String.raw`"%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*`;
const LOCAL_CODEX_SHIM = String.raw`"%_prog%"  "%dp0%\..\@openai\codex\bin\codex.js" %*`;

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

const createFile = (segments: string[], content = ""): string => {
  const file = path.join(root, ...segments);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
};

const createRoot = () => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "odt-runtime-launch-")));
};

const CODEX_PACKAGE = ["npm", "node_modules", "@openai", "codex"];
const createCodexPackage = () => createFile([...CODEX_PACKAGE, "bin", "codex.js"]);
const codexBinary = (packageDirectory: string[], layout: "bin" | "codex" = "bin") =>
  createFile([...packageDirectory, "vendor", target, layout, "codex.exe"]);
describe("resolveCodexNpmShim", () => {
  test("starts the Codex binary of the nested platform package with the codex.js environment", () => {
    createRoot();
    const shim = createFile(["npm", "codex.cmd"], CODEX_SHIM);
    createCodexPackage();
    const platformPackage = [...CODEX_PACKAGE, "node_modules", "@openai", "codex-win32-x64"];
    const binary = codexBinary(platformPackage);
    createFile([...platformPackage, "package.json"]);
    expect(
      resolveCodexNpmShim(readNpmShim(shim), { CODEX_MANAGED_BY_BUN: "1", KEEP: "yes" }, "x64"),
    ).toEqual({
      executablePath: binary,
      env: {
        KEEP: "yes",
        CODEX_MANAGED_PACKAGE_ROOT: path.join(root, ...CODEX_PACKAGE),
        CODEX_MANAGED_BY_NPM: "1",
      },
    });
  });

  test("resolves a hoisted platform package from the real Codex package of a local pnpm shim", () => {
    createRoot();
    const store = ["project", "node_modules", ".pnpm", "codex", "node_modules", "@openai"];
    createFile([...store, "codex", "bin", "codex.js"]);
    createFile([...store, "codex-win32-x64", "package.json"]);
    const binary = codexBinary([...store, "codex-win32-x64"]);
    createFile(["project", "node_modules", ".modules.yaml"]);
    mkdirSync(path.join(root, "project", "node_modules", "@openai"));
    symlinkSync(
      path.join(root, ...store, "codex"),
      path.join(root, "project", "node_modules", "@openai", "codex"),
    );
    const shim = createFile(["project", "node_modules", ".bin", "codex.cmd"], LOCAL_CODEX_SHIM);
    expect(resolveCodexNpmShim(readNpmShim(shim), {}, "x64")).toEqual({
      executablePath: binary,
      env: {
        CODEX_MANAGED_PACKAGE_ROOT: path.join(root, ...store, "codex"),
        CODEX_MANAGED_BY_PNPM: "1",
      },
    });
  });

  test("puts the helper tools of a Codex release first on the search path", () => {
    createRoot();
    const shim = createFile(["npm", "codex.cmd"], CODEX_SHIM);
    createCodexPackage();
    const binary = codexBinary(CODEX_PACKAGE, "codex");
    const tools = path.join(root, ...CODEX_PACKAGE, "vendor", target, "path");
    mkdirSync(tools);
    const resolved = resolveCodexNpmShim(readNpmShim(shim), { Path: "/usr/bin" }, "x64");
    expect(resolved?.executablePath).toBe(binary);
    expect(resolved?.env).toMatchObject({ Path: `${tools};/usr/bin` });
    expect(resolved?.env).not.toHaveProperty("PATH");
  });

  test("keeps the shim when its package has no binary for this architecture", () => {
    createRoot();
    const shim = createFile(["npm", "codex.cmd"], CODEX_SHIM);
    createCodexPackage();
    codexBinary(CODEX_PACKAGE);
    expect(resolveCodexNpmShim(readNpmShim(shim), {}, "arm64")).toBeNull();
    expect(resolveCodexNpmShim(readNpmShim(shim), {}, "ia32")).toBeNull();
  });

  test("keeps any other launcher", () => {
    createRoot();
    createCodexPackage();
    codexBinary(CODEX_PACKAGE);
    const shim = (segments: string[], content: string) =>
      resolveCodexNpmShim(readNpmShim(createFile(segments, content)), {}, "x64");
    expect(shim(["npm", "codex.cmd"], "@echo off")).toBeNull();
    expect(shim(["tools", "codex.cmd"], CODEX_SHIM)).toBeNull();
  });
});
