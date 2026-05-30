import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createSystemCommandRunner } from "./system-command-runner";

const withTempDir = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-system-command-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

describe("createSystemCommandRunner", () => {
  test("passes the explicit environment to spawned commands", async () => {
    const port = createSystemCommandRunner({
      env: {
        PATH: process.env.PATH,
        OPENDUCKTOR_TEST_VALUE: "from-host-env",
      },
      platform: process.platform,
    });

    const result = await Effect.runPromise(
      port.runCommandAllowFailure("bun", ["-e", "console.log(process.env.OPENDUCKTOR_TEST_VALUE)"]),
    );

    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("from-host-env");
  });

  test("fails before spawn when command discovery cannot resolve the executable", async () => {
    const port = createSystemCommandRunner({
      env: { PATH: "" },
      platform: "linux",
    });

    await expect(
      Effect.runPromise(port.runCommandAllowFailure("missing-tool", [])),
    ).rejects.toThrow("Command missing-tool not found.");
  });

  test("runs Windows cmd and bat launchers with arguments on native Windows", async () => {
    if (process.platform !== "win32") {
      return;
    }

    await withTempDir(async (root) => {
      const toolDir = join(root, "tool dir");
      await mkdir(toolDir);
      const cmd = join(toolDir, "echo-tool.cmd");
      const bat = join(toolDir, "echo-bat.bat");
      await writeFile(cmd, "@echo off\r\necho cmd:%~1:%~2\r\n");
      await writeFile(bat, "@echo off\r\necho bat:%~1:%~2\r\n");

      const port = createSystemCommandRunner({
        env: { PATH: toolDir, PATHEXT: ".CMD;.BAT", ComSpec: process.env.ComSpec },
        platform: "win32",
      });

      const cmdResult = await Effect.runPromise(
        port.runCommandAllowFailure("echo-tool", ["one", "two words"]),
      );
      const batResult = await Effect.runPromise(
        port.runCommandAllowFailure("echo-bat", ["alpha", "beta words"]),
      );

      expect(cmdResult.ok).toBe(true);
      expect(cmdResult.stdout.trim()).toBe("cmd:one:two words");
      expect(batResult.ok).toBe(true);
      expect(batResult.stdout.trim()).toBe("bat:alpha:beta words");
    });
  });

  test("round-trips Windows batch arguments containing cmd metacharacters on native Windows", async () => {
    if (process.platform !== "win32") {
      return;
    }

    await withTempDir(async (root) => {
      const outputPath = join(root, "args.txt");
      const command = join(root, "print-args.cmd");
      await writeFile(
        command,
        [
          "@echo off",
          "setlocal DisableDelayedExpansion",
          'set "ARG1=%~1"',
          'set "ARG2=%~2"',
          'set "ARG3=%~3"',
          'set "ARG4=%~4"',
          'set "ARG5=%~5"',
          'set "ARG6=%~6"',
          'set "ARG7=%~7"',
          `> "${outputPath}" (`,
          "set ARG1",
          "set ARG2",
          "set ARG3",
          "set ARG4",
          "set ARG5",
          "set ARG6",
          "set ARG7",
          ")",
        ].join("\r\n"),
      );

      const port = createSystemCommandRunner({
        env: { PATH: root, PATHEXT: ".CMD", ComSpec: process.env.ComSpec },
        platform: "win32",
      });
      const args = [
        "two words",
        "percent=%APPDATA%",
        "amp=a&b",
        "pipe=a|b",
        "redir=a<b>c",
        "paren=(x)",
        "bang=a!b",
      ];

      const result = await Effect.runPromise(port.runCommandAllowFailure("print-args", args));

      expect(result.ok).toBe(true);
      expect(await readFile(outputPath, "utf8")).toContain(
        [
          "ARG1=two words",
          "ARG2=percent=%APPDATA%",
          "ARG3=amp=a&b",
          "ARG4=pipe=a|b",
          "ARG5=redir=a<b>c",
          "ARG6=paren=(x)",
          "ARG7=bang=a!b",
        ].join("\r\n"),
      );
    });
  });
});
