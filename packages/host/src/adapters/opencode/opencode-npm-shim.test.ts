import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readNpmShim } from "../../infrastructure/process/runtime-launch";
import { resolveOpenCodeNpmShim } from "./opencode-npm-shim";

// npm writes shims like these.
const OPENCODE_SHIM = String.raw`"%dp0%\node_modules\@opencode\cli\bin\opencode.exe"   %*`;
const OPENCODE_V1_SHIM = String.raw`"%_prog%"  "%dp0%\node_modules\opencode-ai\bin\opencode" %*`;

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

const createOpenCodeBinary = () =>
  createFile(["npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe"]);

describe("resolveOpenCodeNpmShim", () => {
  test("starts the OpenCode 2 binary without a change to the environment", () => {
    createRoot();
    const shim = createFile(["npm", "opencode2.cmd"], OPENCODE_SHIM);
    const binary = createOpenCodeBinary();
    const env = { KEEP: "yes" };
    expect(resolveOpenCodeNpmShim(readNpmShim(shim), env, "x64")).toEqual({
      executablePath: binary,
      env,
    });
  });

  test("starts only the package that the shim text names", () => {
    createRoot();
    const opencode = createOpenCodeBinary();
    // OpenCode 1 also installs `opencode.cmd`, beside the OpenCode 2 package.
    expect(
      resolveOpenCodeNpmShim(
        readNpmShim(createFile(["npm", "opencode.cmd"], OPENCODE_V1_SHIM)),
        {},
        "x64",
      ),
    ).toBeNull();
    expect(
      resolveOpenCodeNpmShim(
        readNpmShim(createFile(["npm", "codex.cmd"], OPENCODE_SHIM)),
        {},
        "x64",
      )?.executablePath,
    ).toBe(opencode);
  });
});
