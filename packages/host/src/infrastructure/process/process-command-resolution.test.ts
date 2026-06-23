import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { isExecutableCommandFile, resolveProcessCommandPath } from "./process-command-resolution";

const withTempDir = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-process-command-resolution-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const testIfUnixModeIsAvailable = process.platform === "win32" ? test.skip : test;

describe("isExecutableCommandFile", () => {
  test("rejects missing paths", async () => {
    await withTempDir(async (root) => {
      await expect(
        Effect.runPromise(isExecutableCommandFile(join(root, "missing"), "linux")),
      ).resolves.toBe(false);
    });
  });

  test("rejects executable directories on POSIX platforms", async () => {
    await withTempDir(async (root) => {
      const directory = join(root, "bin");
      await mkdir(directory);
      await chmod(directory, 0o755);

      await expect(Effect.runPromise(isExecutableCommandFile(directory, "linux"))).resolves.toBe(
        false,
      );
    });
  });

  testIfUnixModeIsAvailable("rejects non-executable regular files on POSIX platforms", async () => {
    await withTempDir(async (root) => {
      const binary = join(root, "openducktor");
      await writeFile(binary, "");
      await chmod(binary, 0o644);

      await expect(Effect.runPromise(isExecutableCommandFile(binary, "linux"))).resolves.toBe(
        false,
      );
    });
  });

  test("accepts runnable Windows files without POSIX execute bits", async () => {
    await withTempDir(async (root) => {
      const binary = join(root, "openducktor.exe");
      await writeFile(binary, "");
      await chmod(binary, 0o644);

      await expect(Effect.runPromise(isExecutableCommandFile(binary, "win32"))).resolves.toBe(true);
    });
  });
});

describe("resolveProcessCommandPath", () => {
  test("resolves commands from explicit PATH", async () => {
    if (process.platform === "win32") {
      return;
    }

    await withTempDir(async (root) => {
      const executable = join(root, "custom-tool");
      await writeFile(executable, "#!/bin/sh\nexit 0\n");
      await chmod(executable, 0o755);

      await expect(
        Effect.runPromise(
          resolveProcessCommandPath("custom-tool", {
            env: { PATH: root },
            platform: "darwin",
          }),
        ),
      ).resolves.toBe(executable);
    });
  });

  testIfUnixModeIsAvailable("requires executable bits for POSIX command discovery", async () => {
    await withTempDir(async (root) => {
      const candidate = join(root, "not-executable");
      await writeFile(candidate, "#!/bin/sh\nexit 0\n");
      await chmod(candidate, 0o644);

      await expect(
        Effect.runPromise(
          resolveProcessCommandPath("not-executable", {
            env: { PATH: root },
            platform: "linux",
          }),
        ),
      ).resolves.toBe(null);
    });
  });

  test("rejects executable directories during POSIX command discovery", async () => {
    await withTempDir(async (root) => {
      const candidate = join(root, "not-a-command");
      await mkdir(candidate);
      await chmod(candidate, 0o755);

      await expect(
        Effect.runPromise(
          resolveProcessCommandPath("not-a-command", {
            env: { PATH: root },
            platform: "linux",
          }),
        ),
      ).resolves.toBe(null);
    });
  });

  test("uses Windows PATHEXT discovery with caller ordering", async () => {
    await withTempDir(async (root) => {
      const cmd = join(root, "tool.CMD");
      const exe = join(root, "tool.EXE");
      await writeFile(cmd, "");
      await writeFile(exe, "");

      await expect(
        Effect.runPromise(
          resolveProcessCommandPath("tool", {
            env: { PATH: root, PATHEXT: ".CMD;.EXE" },
            platform: "win32",
          }),
        ),
      ).resolves.toBe(cmd);
    });
  });

  test("uses the Windows Path environment key when PATH casing differs", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "tool.CMD"), "");

      await expect(
        Effect.runPromise(
          resolveProcessCommandPath("tool", {
            env: { Path: root, PATHEXT: ".CMD" },
            platform: "win32",
          }),
        ),
      ).resolves.toBe(join(root, "tool.CMD"));
    });
  });

  test("uses default Windows PATHEXT entries when PATHEXT is absent", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "tool.BAT"), "");

      await expect(
        Effect.runPromise(
          resolveProcessCommandPath("tool", {
            env: { PATH: root },
            platform: "win32",
          }),
        ),
      ).resolves.toBe(join(root, "tool.BAT"));
    });
  });

  test("validates explicit Windows executable paths independently from PATHEXT", async () => {
    await withTempDir(async (root) => {
      const candidate = join(root, "tool.exe");
      await writeFile(candidate, "");

      await expect(Effect.runPromise(isExecutableCommandFile(candidate, "win32"))).resolves.toBe(
        true,
      );
      await expect(
        Effect.runPromise(
          resolveProcessCommandPath(candidate, {
            env: { PATHEXT: ".CMD", PATH: "" },
            platform: "win32",
          }),
        ),
      ).resolves.toBe(candidate);
    });
  });

  test("rejects Windows regular files with non-runnable extensions", async () => {
    await withTempDir(async (root) => {
      const candidate = join(root, "tool.txt");
      await writeFile(candidate, "");

      await expect(
        Effect.runPromise(
          resolveProcessCommandPath(candidate, {
            env: { PATH: root },
            platform: "win32",
          }),
        ),
      ).resolves.toBe(null);
    });
  });

  test("validates explicit command paths directly", async () => {
    await withTempDir(async (root) => {
      const candidate = join(root, "custom-tool");
      await writeFile(candidate, "#!/bin/sh\nexit 0\n");
      await chmod(candidate, 0o755);

      await expect(
        Effect.runPromise(
          resolveProcessCommandPath(candidate, {
            env: { PATH: "" },
            platform: "linux",
          }),
        ),
      ).resolves.toBe(candidate);
    });
  });
});
