import { describe, expect, test } from "bun:test";
import {
  buildLoginShellPathProbeArgs,
  createProcessEnvironment,
  mergePathValues,
  normalizeProcessEnvironment,
  parsePathFromLoginShellOutput,
  pathEnvironmentKey,
  pathEnvironmentValue,
} from "./process-environment";

describe("createProcessEnvironment", () => {
  test("merges the macOS login shell PATH before the inherited GUI PATH", () => {
    const env = createProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "darwin",
      readLoginShellPath: () => "/opt/homebrew/bin:/usr/bin",
    });

    expect(env.PATH?.split(":")).toEqual(["/opt/homebrew/bin", "/usr/bin", "/bin"]);
  });

  test("does not read a login shell PATH on non-macOS platforms", () => {
    const env = createProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "linux",
      readLoginShellPath: () => {
        throw new Error("login shell should not be read on Linux");
      },
    });

    expect(env.PATH).toBe("/usr/bin:/bin");
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

    expect(pathEnvironmentKey(baseEnv, "win32")).toBe("PATH");
    expect(pathEnvironmentValue(baseEnv, "win32")).toBe("C:\\Tools\\bin");
    expect(env).toMatchObject({ Path: "C:\\Tools\\bin" });
    expect(env.PATH).toBeUndefined();
  });
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

describe("mergePathValues", () => {
  test("keeps first occurrence of duplicate PATH entries", () => {
    expect(mergePathValues("/opt/bin:/usr/bin", "/usr/bin:/bin", ":")).toBe(
      "/opt/bin:/usr/bin:/bin",
    );
  });
});

describe("parsePathFromLoginShellOutput", () => {
  test("extracts PATH after the shell output marker", () => {
    const output = Buffer.from(
      "profile noise\0__OPENDUCKTOR_ENV_START__\0USER=max\0PATH=/opt/bin:/usr/bin\0",
    );

    expect(parsePathFromLoginShellOutput(output)).toBe("/opt/bin:/usr/bin");
  });
});

describe("buildLoginShellPathProbeArgs", () => {
  test("does not request an interactive shell that can take terminal job control", () => {
    const args = buildLoginShellPathProbeArgs();

    expect(args).toEqual(["-c", "printf '__OPENDUCKTOR_ENV_START__\\0'; /usr/bin/env -0"]);
    expect(args).not.toContain("-i");
  });
});
