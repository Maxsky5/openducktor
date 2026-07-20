import { describe, expect, test } from "bun:test";
import { posix } from "node:path";
import { Effect } from "effect";
import { createTerminalLaunchEnvironment } from "../../infrastructure/terminals/terminal-launch-environment";
import type { FilesystemPort } from "../../ports/filesystem-port";
import { createTerminalLaunchPolicy } from "./terminal-launch-policy";

const filesystem: FilesystemPort = {
  homeDirectory: () => "/home/user",
  canonicalize: (path: string) => Effect.succeed(`/canonical${path}`),
  readDirectory: () => Effect.succeed([]),
  readFileBytes: () => Effect.succeed(new Uint8Array()),
  stat: () => Effect.succeed({ isDirectory: true }),
  exists: () => Effect.succeed(true),
  join: posix.join,
  relative: posix.relative,
  parent: (path) => (path === "/" ? null : posix.dirname(path)),
};

describe("terminal launch policy", () => {
  test("canonicalizes the directory and removes control credentials", async () => {
    const processEnv = {
      ODT_HOST_TOKEN: "host-secret",
      OPENDUCKTOR_APP_TOKEN: "app-secret",
      PATH: "/usr/bin",
      SHELL: "/bin/zsh",
    };
    const plan = await Effect.runPromise(
      createTerminalLaunchPolicy({
        filesystem,
        resolveEnvironment: createTerminalLaunchEnvironment({
          processEnv,
          platform: "darwin",
          readUserShell: () => null,
        }),
      })({ workingDir: "/repo", context: {} }, { columns: 80, rows: 24 }),
    );
    expect(plan.cwd).toBe("/canonical/repo");
    expect(plan.shell).toBe("/bin/zsh");
    expect(plan.args).toEqual(["-l"]);
    expect(plan.env.TERM).toBe("xterm-256color");
    expect(plan.env.ODT_HOST_TOKEN).toBeUndefined();
    expect(plan.env.OPENDUCKTOR_APP_TOKEN).toBeUndefined();
  });

  test("rejects a non-directory and does not select another path", async () => {
    const nonDirectory = { ...filesystem, stat: () => Effect.succeed({ isDirectory: false }) };
    const result = await Effect.runPromiseExit(
      createTerminalLaunchPolicy({
        filesystem: nonDirectory,
        resolveEnvironment: createTerminalLaunchEnvironment({
          processEnv: { SHELL: "/bin/zsh" },
          platform: "darwin",
        }),
      })({ workingDir: "/file", context: {} }, { columns: 80, rows: 24 }),
    );
    expect(result._tag).toBe("Failure");
    expect(String(result)).toContain("working_directory_not_directory");
  });
});
