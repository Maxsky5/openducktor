import { describe, expect, test } from "bun:test";
import { HostValidationError } from "../../effect/host-errors";
import { createProcessCommandLaunch, parseProcessCommandLine } from "./process-command-launch";
import { buildWindowsBatchCommandLine } from "./process-windows-command-line";

describe("createProcessCommandLaunch", () => {
  test("builds a Windows shell launch for cmd files with quoted config arguments", () => {
    const command = String.raw`C:\Program Files\Codex\codex.cmd`;
    const args = [
      "--config",
      'mcp_servers.openducktor.command="mcp-bin"',
      "path=%APPDATA%\\foo",
      "caret=foo^bar",
    ];
    const launch = createProcessCommandLaunch(
      command,
      args,
      { ComSpec: String.raw`C:\Windows\System32\cmd.exe` },
      "win32",
    );

    expect(launch).toEqual({
      command: String.raw`C:\Windows\System32\cmd.exe`,
      env: { ComSpec: String.raw`C:\Windows\System32\cmd.exe` },
      windowsVerbatimArguments: true,
      args: ["/d", "/v:off", "/s", "/c", buildWindowsBatchCommandLine(command, args)],
    });
  });

  test("escapes Windows shell arguments in the canonical batch command-line payload", () => {
    const command = "tool.cmd";
    const args = ["plain", "two words", 'quote="value"', "percent=%APPDATA%", "caret=foo^bar"];
    const launch = createProcessCommandLaunch(command, args, {}, "win32");

    expect(launch).toEqual({
      command: "cmd.exe",
      env: {},
      windowsVerbatimArguments: true,
      args: ["/d", "/v:off", "/s", "/c", buildWindowsBatchCommandLine(command, args)],
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
      env: { ComSpec: String.raw`C:\Windows\System32\cmd.exe` },
      windowsVerbatimArguments: true,
      args: ["/d", "/v:off", "/s", "/c", buildWindowsBatchCommandLine(command, args)],
    });
  });

  test("does not read ambient ComSpec when the launch environment omits it", () => {
    const originalComSpec = process.env.ComSpec;
    process.env.ComSpec = String.raw`C:\Global\cmd.exe`;
    try {
      expect(createProcessCommandLaunch("tool.cmd", [], {}, "win32")).toMatchObject({
        command: "cmd.exe",
        env: {},
      });
      expect(createProcessCommandLaunch("tool.cmd", [], { ComSpec: "  " }, "win32")).toMatchObject({
        command: "cmd.exe",
        env: { ComSpec: "  " },
      });
    } finally {
      if (originalComSpec === undefined) {
        delete process.env.ComSpec;
      } else {
        process.env.ComSpec = originalComSpec;
      }
    }
  });

  test("does not wrap non-Windows or non-script launches", () => {
    expect(createProcessCommandLaunch("tool.cmd", ["one"], {}, "linux")).toEqual({
      command: "tool.cmd",
      args: ["one"],
      env: {},
      windowsVerbatimArguments: false,
    });
    expect(createProcessCommandLaunch("tool.exe", ["one"], {}, "win32")).toEqual({
      command: "tool.exe",
      args: ["one"],
      env: {},
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
