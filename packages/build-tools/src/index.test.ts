import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanDirectory, markExecutable, runCommand } from "./index";

describe("build tools", () => {
  it("removes a directory tree", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-build-tools-"));
    const targetDirectory = join(baseDirectory, "dist");

    try {
      await mkdir(join(targetDirectory, "nested"), { recursive: true });
      await writeFile(join(targetDirectory, "nested", "file.txt"), "content");

      await cleanDirectory(targetDirectory);

      expect(await readdir(baseDirectory)).toEqual([]);
    } finally {
      await rm(baseDirectory, { force: true, recursive: true });
    }
    // Real disk I/O in the temp directory. It usually takes under 15 ms, but on the Windows CI
    // runner the temp directory can stall for more than a second.
  }, 5_000);

  it("marks files executable on POSIX platforms", async () => {
    const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-build-tools-"));
    const filePath = join(baseDirectory, "tool");

    try {
      await writeFile(filePath, "#!/usr/bin/env bun\n");

      await markExecutable(filePath);

      const mode = (await stat(filePath)).mode;
      if (process.platform !== "win32") {
        expect(mode & 0o111).not.toBe(0);
      }
    } finally {
      await rm(baseDirectory, { force: true, recursive: true });
    }
  });

  it.each([
    {
      name: "inherits the current parent environment when env is absent",
      env: undefined,
      expected: "parent",
    },
    {
      name: "uses a supplied environment without restoring parent keys",
      env: { OPENDUCKTOR_BUILD_TOOLS_TEST: "supplied" },
      expected: "supplied",
    },
    { name: "omits parent keys when env is empty", env: {}, expected: null },
  ])(
    "$name",
    async ({ env, expected }) => {
      const baseDirectory = await mkdtemp(join(tmpdir(), "openducktor-command-env-"));
      const parentEnv = {
        OPENDUCKTOR_BUILD_TOOLS_TEST: process.env.OPENDUCKTOR_BUILD_TOOLS_TEST,
        OPENDUCKTOR_BUILD_TOOLS_PARENT: process.env.OPENDUCKTOR_BUILD_TOOLS_PARENT,
      };

      try {
        process.env.OPENDUCKTOR_BUILD_TOOLS_TEST = "parent";
        process.env.OPENDUCKTOR_BUILD_TOOLS_PARENT = "parent-only";
        const input: Parameters<typeof runCommand>[0] = {
          command: [
            process.execPath,
            "--no-env-file",
            "-e",
            `await Bun.write("env.json", JSON.stringify({
            value: process.env.OPENDUCKTOR_BUILD_TOOLS_TEST ?? null,
            parent: process.env.OPENDUCKTOR_BUILD_TOOLS_PARENT ?? null,
          }));`,
          ],
          cwd: baseDirectory,
          label: "Environment command",
        };
        if (env !== undefined) input.env = env;
        await runCommand(input);

        expect(await Bun.file(join(baseDirectory, "env.json")).json()).toEqual({
          value: expected,
          parent: env === undefined ? "parent-only" : null,
        });
      } finally {
        for (const [key, value] of Object.entries(parentEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        await rm(baseDirectory, { force: true, recursive: true });
      }
      // Each case starts a real subprocess and uses the filesystem.
    },
    5_000,
  );

  it("inherits stdout and stderr", async () => {
    const subprocess = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "-e",
        `import { runCommand } from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
      await runCommand({
        command: [process.execPath, "--no-env-file", "-e",
          "process.stdout.write('build stdout'); process.stderr.write('build stderr');"],
        cwd: process.cwd(),
        env: {},
        label: "Output command",
      });`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("build stdout");
    expect(stderr).toBe("build stderr");
    // Capturing inherited output requires two real subprocesses.
  }, 5_000);

  it("reports the failing build step label and exit code", async () => {
    const error = await runCommand({
      command: [process.execPath, "--no-env-file", "-e", "process.exit(7)"],
      cwd: process.cwd(),
      label: "Failing command",
    }).catch((cause: unknown): Error =>
      cause instanceof Error ? cause : new Error(String(cause), { cause }),
    );

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw error;
    expect(error.message).toBe("Failing command failed with exit code 7.");
    // The failure comes from a real subprocess.
  }, 5_000);
});
