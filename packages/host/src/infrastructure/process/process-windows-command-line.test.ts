import { describe, expect, test } from "bun:test";
import { HostValidationError } from "../../effect/host-errors";
import { buildWindowsBatchCommandLine } from "./process-windows-command-line";

describe("buildWindowsBatchCommandLine", () => {
  test("builds the single cmd.exe /c payload for a batch command", () => {
    expect(
      buildWindowsBatchCommandLine(String.raw`C:\Program Files\Codex\codex.cmd`, [
        "--config",
        'mcp_servers.openducktor.command="mcp-bin"',
        String.raw`path=%APPDATA%\foo`,
        "caret=foo^bar",
      ]),
    ).toBe(
      String.raw`""C:\Program Files\Codex\codex.cmd" "--config" "mcp_servers.openducktor.command=^"mcp-bin^"" "path=%APPDATA%\foo" "caret=foo^^bar""`,
    );
  });

  test("rejects carriage returns and newlines in commands", () => {
    expect(() => buildWindowsBatchCommandLine("tool.cmd\nwhoami", [])).toThrow(HostValidationError);
  });

  test("rejects carriage returns and newlines in arguments", () => {
    expect(() => buildWindowsBatchCommandLine("tool.cmd", ["safe\nunsafe"])).toThrow(
      HostValidationError,
    );
    expect(() => buildWindowsBatchCommandLine("tool.cmd", ["safe\runsafe"])).toThrow(
      HostValidationError,
    );
  });
});
