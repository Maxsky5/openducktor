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
  }, 5000);

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

  it("runs commands and reports the failing build step label", async () => {
    await runCommand({
      command: [
        "bun",
        "-e",
        "if (process.env.OPENDUCKTOR_BUILD_TOOLS_TEST !== 'set') process.exit(9)",
      ],
      cwd: process.cwd(),
      env: { OPENDUCKTOR_BUILD_TOOLS_TEST: "set" },
      label: "Environment command",
    });

    const error = await runCommand({
      command: ["bun", "-e", "process.exit(7)"],
      cwd: process.cwd(),
      label: "Failing command",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Failing command failed with exit code 7.");
  }, 5000);
});
