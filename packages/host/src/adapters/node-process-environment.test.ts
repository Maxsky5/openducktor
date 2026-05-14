import { describe, expect, test } from "bun:test";
import { delimiter } from "node:path";
import {
  createNodeProcessEnvironment,
  mergePathValues,
  parsePathFromLoginShellOutput,
} from "./node-process-environment";

describe("createNodeProcessEnvironment", () => {
  test("merges the macOS login shell PATH before the inherited GUI PATH", () => {
    const env = createNodeProcessEnvironment({
      baseEnv: { PATH: "/usr/bin:/bin" },
      platform: "darwin",
      readLoginShellPath: () => "/opt/homebrew/bin:/usr/bin",
    });

    expect(env.PATH?.split(delimiter)).toEqual(["/opt/homebrew/bin", "/usr/bin", "/bin"]);
  });

  test("does not read a login shell PATH on non-macOS platforms", () => {
    const env = createNodeProcessEnvironment({
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

    const env = createNodeProcessEnvironment({
      baseEnv,
      platform: "darwin",
      readLoginShellPath: () => "/opt/homebrew/bin",
    });

    expect(baseEnv.PATH).toBe("/usr/bin:/bin");
    expect(env.PATH).toBe(`/opt/homebrew/bin${delimiter}/usr/bin${delimiter}/bin`);
  });
});

describe("mergePathValues", () => {
  test("keeps first occurrence of duplicate PATH entries", () => {
    expect(mergePathValues("/opt/bin:/usr/bin", "/usr/bin:/bin")).toBe(
      `/opt/bin${delimiter}/usr/bin${delimiter}/bin`,
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
