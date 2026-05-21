import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createSystemCommandLaunch, createSystemCommandRunner } from "./system-command-runner";

const withTempDir = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "odt-system-command-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

describe("createSystemCommandRunner", () => {
  test("resolves required commands from its explicit environment", async () => {
    if (process.platform === "win32") {
      return;
    }

    await withTempDir(async (root) => {
      const executable = join(root, "custom-tool");
      await writeFile(executable, "#!/bin/sh\nexit 0\n");
      await chmod(executable, 0o755);

      const port = createSystemCommandRunner({
        env: { PATH: root },
        platform: "darwin",
      });

      await expect(Effect.runPromise(port.requiredCommandError("custom-tool"))).resolves.toBeNull();
      await expect(Effect.runPromise(port.requiredCommandError("missing-tool"))).resolves.toBe(
        "Required command `missing-tool` not found. Install missing-tool and ensure it is available on PATH.",
      );
    });
  });

  test("requires executable bits for POSIX command discovery", async () => {
    await withTempDir(async (root) => {
      const candidate = join(root, "not-executable");
      await writeFile(candidate, "#!/bin/sh\nexit 0\n");
      await chmod(candidate, 0o644);

      const port = createSystemCommandRunner({
        env: { PATH: root },
        platform: "linux",
      });

      await expect(Effect.runPromise(port.requiredCommandError("not-executable"))).resolves.toBe(
        "Required command `not-executable` not found. Install not-executable and ensure it is available on PATH.",
      );
    });
  });

  test("uses Windows PATHEXT discovery with caller ordering", async () => {
    await withTempDir(async (root) => {
      const cmd = join(root, "tool.CMD");
      const exe = join(root, "tool.EXE");
      await writeFile(cmd, "");
      await writeFile(exe, "");

      const port = createSystemCommandRunner({
        env: { PATH: root, PATHEXT: ".CMD;.EXE" },
        platform: "win32",
      });

      await expect(Effect.runPromise(port.requiredCommandError("tool"))).resolves.toBeNull();
      await expect(Effect.runPromise(port.requiredCommandError("tool.CMD"))).resolves.toBeNull();
    });
  });

  test("uses default Windows PATHEXT entries when PATHEXT is absent", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "tool.BAT"), "");

      const port = createSystemCommandRunner({
        env: { PATH: root },
        platform: "win32",
      });

      await expect(Effect.runPromise(port.requiredCommandError("tool"))).resolves.toBeNull();
    });
  });

  test("validates Windows runnable files without POSIX executable bits", async () => {
    await withTempDir(async (root) => {
      const candidate = join(root, "tool.exe");
      await writeFile(candidate, "");
      await chmod(candidate, 0o644);

      const port = createSystemCommandRunner({
        env: { PATH: root },
        platform: "win32",
      });

      await expect(Effect.runPromise(port.requiredCommandError("tool.exe"))).resolves.toBeNull();
    });
  });

  test("validates explicit command paths directly", async () => {
    await withTempDir(async (root) => {
      const candidate = join(root, "custom-tool");
      await writeFile(candidate, "#!/bin/sh\nexit 0\n");
      await chmod(candidate, 0o755);

      const port = createSystemCommandRunner({
        env: { PATH: "" },
        platform: "linux",
      });

      await expect(Effect.runPromise(port.requiredCommandError(candidate))).resolves.toBeNull();
    });
  });

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

  test("builds a Windows shell launch for cmd files with quoted config arguments", () => {
    const launch = createSystemCommandLaunch(
      String.raw`C:\Program Files\Codex\codex.cmd`,
      [
        "--config",
        'mcp_servers.openducktor.command="mcp-bin"',
        "path=%APPDATA%\\foo",
        "caret=foo^bar",
      ],
      { ComSpec: String.raw`C:\Windows\System32\cmd.exe` },
      "win32",
    );

    expect(launch).toEqual({
      command: String.raw`C:\Windows\System32\cmd.exe`,
      args: [
        "/d",
        "/s",
        "/c",
        String.raw`""C:\Program Files\Codex\codex.cmd" --config "mcp_servers.openducktor.command=""mcp-bin""" path=%APPDATA%\foo caret=foo^bar"`,
      ],
      windowsVerbatimArguments: true,
    });
  });

  test("uses process ComSpec fallback for Windows shell launches when the explicit env omits it", () => {
    const originalComSpec = process.env.ComSpec;
    process.env.ComSpec = String.raw`C:\Global\cmd.exe`;
    try {
      expect(createSystemCommandLaunch("tool.cmd", [], {}, "win32").command).toBe(
        String.raw`C:\Global\cmd.exe`,
      );
      expect(createSystemCommandLaunch("tool.cmd", [], { ComSpec: "  " }, "win32").command).toBe(
        String.raw`C:\Global\cmd.exe`,
      );
    } finally {
      if (originalComSpec === undefined) {
        delete process.env.ComSpec;
      } else {
        process.env.ComSpec = originalComSpec;
      }
    }
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
});
