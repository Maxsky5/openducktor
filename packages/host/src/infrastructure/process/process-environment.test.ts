import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createProcessEnvironment,
  normalizeProcessEnvironment,
  pathEnvironmentValue,
  sanitizeChildProcessEnvironment,
} from "./process-environment";

const testIfPosixShellIsAvailable = process.platform === "win32" ? test.skip : test;

describe("createProcessEnvironment", () => {
  test("merges the macOS login shell PATH before the inherited GUI PATH", () => {
    const env = createProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "darwin",
      readLoginShellPath: () => "/opt/homebrew/bin:/usr/bin",
    });

    expect(env.PATH?.split(":")).toEqual(["/opt/homebrew/bin", "/usr/bin", "/bin"]);
  });

  test("merges the Linux login shell PATH before the inherited GUI PATH", () => {
    const env = createProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "linux",
      readLoginShellPath: () => "/home/dev/.local/bin:/usr/bin",
    });

    expect(env.PATH?.split(":")).toEqual(["/home/dev/.local/bin", "/usr/bin", "/bin"]);
  });

  test("does not read a login shell PATH on Windows", () => {
    const env = createProcessEnvironment({
      baseEnv: { Path: "C:\\Windows\\System32" },
      platform: "win32",
      readLoginShellPath: () => {
        throw new Error("login shell should not be read on Windows");
      },
    });

    expect(env.Path).toBe("C:\\Windows\\System32");
  });

  test("does not mutate the caller environment object", () => {
    const baseEnv: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    const env = createProcessEnvironment({
      baseEnv,
      platform: "darwin",
      readLoginShellPath: () => "/opt/homebrew/bin",
    });

    expect(baseEnv.PATH).toBe("/usr/bin:/bin");
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  test("normalizes Windows PATH casing without losing explicit PATH overrides", () => {
    const baseEnv: NodeJS.ProcessEnv = {
      Path: "C:\\Windows\\System32",
      PATH: "C:\\Tools\\bin",
    };

    const env = createProcessEnvironment({
      baseEnv,
      platform: "win32",
      readLoginShellPath: () => {
        throw new Error("login shell should not be read on Windows");
      },
    });

    expect(pathEnvironmentValue(baseEnv, "win32")).toBe("C:\\Tools\\bin");
    expect(env).toMatchObject({ Path: "C:\\Tools\\bin" });
    expect(env.PATH).toBeUndefined();
  });

  testIfPosixShellIsAvailable(
    "reads and merges PATH from the current user's login shell",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "odt-login-shell-path-"));
      const shellPath = path.join(root, "fake-shell");
      try {
        await writeFile(
          shellPath,
          "#!/bin/sh\nprintf 'profile noise\\0__OPENDUCKTOR_ENV_START__\\0USER=max\\0PATH=/opt/bin:/usr/bin\\0'\n",
        );
        await chmod(shellPath, 0o755);

        const env = createProcessEnvironment({
          baseEnv: { SHELL: shellPath, PATH: "/usr/bin:/bin" },
          platform: "darwin",
        });

        expect(env.PATH?.split(":")).toEqual(["/opt/bin", "/usr/bin", "/bin"]);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );
});

describe("normalizeProcessEnvironment", () => {
  test("deduplicates Windows PATH keys before spawning child processes", () => {
    expect(
      normalizeProcessEnvironment(
        {
          Path: "C:\\Windows",
          PATH: "C:\\Tools",
          PaTh: "C:\\Other",
        },
        "win32",
      ),
    ).toEqual({ Path: "C:\\Tools" });
  });
});

describe("sanitizeChildProcessEnvironment", () => {
  test("removes host-control values without mutating the resolved environment", () => {
    const resolvedEnvironment: NodeJS.ProcessEnv = {
      PATH: "/already/resolved:/usr/bin",
      ODT_HOST_TOKEN: "host-secret",
      OPENDUCKTOR_APP_TOKEN: "app-secret",
      USER_SETTING: "preserved",
    };

    const childEnvironment = sanitizeChildProcessEnvironment(resolvedEnvironment, "darwin");

    expect(childEnvironment).toEqual({
      PATH: "/already/resolved:/usr/bin",
      USER_SETTING: "preserved",
    });
    expect(resolvedEnvironment.ODT_HOST_TOKEN).toBe("host-secret");
  });

  test("removes host-control values case-insensitively on Windows", () => {
    expect(
      sanitizeChildProcessEnvironment(
        {
          Path: "C:\\Windows",
          odt_host_token: "host-secret",
        },
        "win32",
      ),
    ).toEqual({ Path: "C:\\Windows" });
  });
});
