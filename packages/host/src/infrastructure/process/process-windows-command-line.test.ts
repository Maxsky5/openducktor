import { describe, expect, test } from "bun:test";
import { HostValidationError } from "../../effect/host-errors";
import {
  buildWindowsBatchCommandLine,
  quoteWindowsBatchArgument,
} from "./process-windows-command-line";

describe("quoteWindowsBatchArgument", () => {
  test("escapes batch expansion and quote characters inside one argv value", () => {
    expect(quoteWindowsBatchArgument('path=%APPDATA% caret=foo^bar bang=!value! quote="x"')).toBe(
      '"path=^%APPDATA^% caret=foo^^bar bang=!value! quote=^"x^""',
    );
  });

  test("rejects carriage returns and newlines", () => {
    expect(() => quoteWindowsBatchArgument("safe\nunsafe")).toThrow(HostValidationError);
    expect(() => quoteWindowsBatchArgument("safe\runsafe")).toThrow(HostValidationError);
  });
});

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
      String.raw`""C:\Program Files\Codex\codex.cmd" "--config" "mcp_servers.openducktor.command=^"mcp-bin^"" "path=^%APPDATA^%\foo" "caret=foo^^bar""`,
    );
  });

  test("rejects carriage returns and newlines in commands", () => {
    expect(() => buildWindowsBatchCommandLine("tool.cmd\nwhoami", [])).toThrow(HostValidationError);
  });
});
