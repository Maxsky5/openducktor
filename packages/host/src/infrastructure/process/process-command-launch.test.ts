import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostValidationError } from "../../effect/host-errors";
import { createProcessCommandLaunch, parseProcessCommandLine } from "./process-command-launch";

describe("createProcessCommandLaunch", () => {
  test("builds a Windows shell launch for cmd files with quoted config arguments", () => {
    const command = String.raw`C:\Program Files\Codex\codex.cmd`;
    const args = [
      "--config",
      "mcp_servers.openducktor.command='mcp-bin'",
      "path=%APPDATA%\\foo",
      "trail=C:\\tools\\",
    ];
    const launch = createProcessCommandLaunch(
      command,
      args,
      { ComSpec: String.raw`C:\Windows\System32\cmd.exe` },
      "win32",
    );

    expect(launch).toEqual({
      command: String.raw`C:\Windows\System32\cmd.exe`,
      env: {
        ComSpec: String.raw`C:\Windows\System32\cmd.exe`,
        OPENDUCKTOR_WINDOWS_COMMAND: command,
        OPENDUCKTOR_WINDOWS_ARG_0: "--config",
        OPENDUCKTOR_WINDOWS_ARG_1: "mcp_servers.openducktor.command='mcp-bin'",
        OPENDUCKTOR_WINDOWS_ARG_2: "path=%APPDATA%\\foo",
        OPENDUCKTOR_WINDOWS_ARG_3: "trail=C:\\tools\\\\",
      },
      windowsHide: true,
      windowsVerbatimArguments: true,
      args: [
        "/d",
        "/v:off",
        "/s",
        "/c",
        '""%OPENDUCKTOR_WINDOWS_COMMAND%" "%OPENDUCKTOR_WINDOWS_ARG_0%" "%OPENDUCKTOR_WINDOWS_ARG_1%" "%OPENDUCKTOR_WINDOWS_ARG_2%" "%OPENDUCKTOR_WINDOWS_ARG_3%""',
      ],
    });
  });

  test("passes safe Windows shell arguments through argv for batch shims", () => {
    const command = "tool.cmd";
    const args = ["plain", "two words", "percent=%APPDATA%", "trail=C:\\tools\\"];
    const launch = createProcessCommandLaunch(command, args, {}, "win32");

    expect(launch).toEqual({
      command: "cmd.exe",
      env: {
        OPENDUCKTOR_WINDOWS_COMMAND: command,
        OPENDUCKTOR_WINDOWS_ARG_0: "plain",
        OPENDUCKTOR_WINDOWS_ARG_1: "two words",
        OPENDUCKTOR_WINDOWS_ARG_2: "percent=%APPDATA%",
        OPENDUCKTOR_WINDOWS_ARG_3: "trail=C:\\tools\\\\",
      },
      windowsHide: true,
      windowsVerbatimArguments: true,
      args: [
        "/d",
        "/v:off",
        "/s",
        "/c",
        '""%OPENDUCKTOR_WINDOWS_COMMAND%" "%OPENDUCKTOR_WINDOWS_ARG_0%" "%OPENDUCKTOR_WINDOWS_ARG_1%" "%OPENDUCKTOR_WINDOWS_ARG_2%" "%OPENDUCKTOR_WINDOWS_ARG_3%""',
      ],
    });
  });

  test("builds the same Windows shell launch for bat files", () => {
    const command = String.raw`C:\Program Files\Dev Server\start.bat`;
    const args = ["--port", "5173"];
    const launch = createProcessCommandLaunch(
      command,
      args,
      {
        ComSpec: String.raw`C:\Windows\System32\cmd.exe`,
      },
      "win32",
    );

    expect(launch).toEqual({
      command: String.raw`C:\Windows\System32\cmd.exe`,
      env: {
        ComSpec: String.raw`C:\Windows\System32\cmd.exe`,
        OPENDUCKTOR_WINDOWS_COMMAND: command,
        OPENDUCKTOR_WINDOWS_ARG_0: "--port",
        OPENDUCKTOR_WINDOWS_ARG_1: "5173",
      },
      windowsHide: true,
      windowsVerbatimArguments: true,
      args: [
        "/d",
        "/v:off",
        "/s",
        "/c",
        '""%OPENDUCKTOR_WINDOWS_COMMAND%" "%OPENDUCKTOR_WINDOWS_ARG_0%" "%OPENDUCKTOR_WINDOWS_ARG_1%""',
      ],
    });
  });

  test.skipIf(process.platform !== "win32")(
    "passes safe arguments through a Windows cmd shim",
    () => {
      const tempDirectory = mkdtempSync(join(tmpdir(), "odt-cmd-launch-"));
      try {
        const printArgsScript = join(tempDirectory, "print-args.js");
        writeFileSync(printArgsScript, "console.log(JSON.stringify(process.argv.slice(2)));");

        const shim = join(tempDirectory, "shim.cmd");
        writeFileSync(
          shim,
          [`@echo off`, `"${process.execPath}" "%~dp0print-args.js" %*`].join("\r\n"),
        );

        const commandArgs = ["percent=%APPDATA%", "trail=C:\\foo\\", "two words"];
        const launch = createProcessCommandLaunch(shim, commandArgs, process.env, "win32");
        const result = spawnSync(launch.command, launch.args, {
          encoding: "utf8",
          env: launch.env,
          windowsHide: launch.windowsHide,
          windowsVerbatimArguments: launch.windowsVerbatimArguments,
        });

        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(commandArgs);
      } finally {
        rmSync(tempDirectory, { force: true, recursive: true });
      }
    },
  );

  test("does not read ambient ComSpec when the launch environment omits it", () => {
    const originalComSpec = process.env.ComSpec;
    process.env.ComSpec = String.raw`C:\Global\cmd.exe`;
    try {
      expect(createProcessCommandLaunch("tool.cmd", [], {}, "win32")).toMatchObject({
        command: "cmd.exe",
        env: {
          OPENDUCKTOR_WINDOWS_COMMAND: "tool.cmd",
        },
      });
      expect(createProcessCommandLaunch("tool.cmd", [], { ComSpec: "  " }, "win32")).toMatchObject({
        command: "cmd.exe",
        env: {
          ComSpec: "  ",
          OPENDUCKTOR_WINDOWS_COMMAND: "tool.cmd",
        },
      });
    } finally {
      if (originalComSpec === undefined) {
        delete process.env.ComSpec;
      } else {
        process.env.ComSpec = originalComSpec;
      }
    }
  });

  test("rejects newlines before passing Windows commands through the shell", () => {
    expect(() => createProcessCommandLaunch("tool.cmd\nwhoami", [], {}, "win32")).toThrow(
      HostValidationError,
    );
    expect(() => createProcessCommandLaunch("tool.cmd", ["safe\runsafe"], {}, "win32")).toThrow(
      HostValidationError,
    );
  });

  test("keeps quoted Windows batch metacharacters in env-backed arguments", () => {
    const unsafeOutsideQuotes = "value=a&b|c<d>e^f";
    const launch = createProcessCommandLaunch("tool.cmd", [unsafeOutsideQuotes], {}, "win32");

    expect(launch.env.OPENDUCKTOR_WINDOWS_ARG_0).toBe(unsafeOutsideQuotes);
  });

  test("rejects Windows batch values that can break out of quoted expansion", () => {
    expect(() => createProcessCommandLaunch("tool.cmd", ['quote="value"'], {}, "win32")).toThrow(
      HostValidationError,
    );
    expect(() => createProcessCommandLaunch('bad"tool.cmd', [], {}, "win32")).toThrow(
      HostValidationError,
    );
  });

  test("does not wrap non-Windows or non-script launches", () => {
    expect(createProcessCommandLaunch("tool.cmd", ["one"], {}, "linux")).toEqual({
      command: "tool.cmd",
      args: ["one"],
      env: {},
      windowsHide: false,
      windowsVerbatimArguments: false,
    });
    expect(createProcessCommandLaunch("tool.exe", ["one"], {}, "win32")).toEqual({
      command: "tool.exe",
      args: ["one"],
      env: {},
      windowsHide: true,
      windowsVerbatimArguments: false,
    });
  });
});

describe("parseProcessCommandLine", () => {
  test("parses quoted command paths and arguments", () => {
    expect(
      parseProcessCommandLine(
        `"/Users/example/path with spaces/node" -e "console.log('ready')" '' "two words"`,
      ),
    ).toEqual({
      command: "/Users/example/path with spaces/node",
      args: ["-e", "console.log('ready')", "", "two words"],
    });
  });

  test("preserves Windows backslashes in quoted paths", () => {
    expect(
      parseProcessCommandLine(String.raw`"C:\Program Files\nodejs\node.exe" "C:\repo dir\app.mjs"`),
    ).toEqual({
      command: String.raw`C:\Program Files\nodejs\node.exe`,
      args: [String.raw`C:\repo dir\app.mjs`],
    });
  });

  test("keeps literal quotes when grouped with the other quote character", () => {
    expect(parseProcessCommandLine(`node -e 'console.log("ready")'`)).toEqual({
      command: "node",
      args: ["-e", 'console.log("ready")'],
    });
  });

  test("preserves escaped quotes inside double-quoted arguments", () => {
    expect(parseProcessCommandLine(String.raw`node -e "console.log(\"ready\")"`)).toEqual({
      command: "node",
      args: ["-e", 'console.log("ready")'],
    });
    expect(parseProcessCommandLine(String.raw`tool --config "key=\"value\""`)).toEqual({
      command: "tool",
      args: ["--config", 'key="value"'],
    });
  });

  test("rejects empty commands", () => {
    expect(() => parseProcessCommandLine("  \t  ")).toThrow(HostValidationError);
  });

  test("rejects unmatched quotes with an actionable validation error", () => {
    expect(() => parseProcessCommandLine(`node -e "console.log('ready')`)).toThrow(
      "Dev server command has an unmatched quote. Fix the command syntax or invoke a shell explicitly.",
    );
  });
});
