import { describe, expect, test } from "bun:test";
import { HostValidationError } from "../../effect/host-errors";
import {
  assertNoWindowsShellNewlines,
  assertSafeWindowsBatchValue,
  buildWindowsBatchEnvCommandLine,
  escapeWindowsQuotedArgumentValue,
} from "./process-windows-command-line";

describe("assertNoWindowsShellNewlines", () => {
  test("rejects carriage returns and newlines", () => {
    expect(() => assertNoWindowsShellNewlines("safe\nunsafe", "argument")).toThrow(
      HostValidationError,
    );
    expect(() => assertNoWindowsShellNewlines("safe\runsafe", "argument")).toThrow(
      HostValidationError,
    );
  });
});

describe("assertSafeWindowsBatchValue", () => {
  test("accepts metacharacters that stay inside quoted variable expansion", () => {
    expect(() => assertSafeWindowsBatchValue("value=a&b|c<d>e^f", "argument")).not.toThrow();
  });

  test("rejects double quotes that can break out of quoted variable expansion", () => {
    expect(() => assertSafeWindowsBatchValue('quote="value"', "argument")).toThrow(
      HostValidationError,
    );
  });
});

describe("escapeWindowsQuotedArgumentValue", () => {
  test("escapes values that are expanded inside an already quoted Windows argument", () => {
    expect(escapeWindowsQuotedArgumentValue('quote="value"')).toBe('quote=\\"value\\"');
    expect(escapeWindowsQuotedArgumentValue("path=C:\\tools\\")).toBe("path=C:\\tools\\\\");
    expect(escapeWindowsQuotedArgumentValue('path=C:\\tools\\"bin"')).toBe(
      'path=C:\\tools\\\\\\"bin\\"',
    );
  });
});

describe("buildWindowsBatchEnvCommandLine", () => {
  test("builds the single cmd.exe /c payload from environment references", () => {
    expect(
      buildWindowsBatchEnvCommandLine("OPENDUCKTOR_WINDOWS_COMMAND", [
        "OPENDUCKTOR_WINDOWS_ARG_0",
        "OPENDUCKTOR_WINDOWS_ARG_1",
      ]),
    ).toBe(
      '""%OPENDUCKTOR_WINDOWS_COMMAND%" "%OPENDUCKTOR_WINDOWS_ARG_0%" "%OPENDUCKTOR_WINDOWS_ARG_1%""',
    );
  });

  test("rejects invalid environment reference names", () => {
    expect(() => buildWindowsBatchEnvCommandLine("bad-name", [])).toThrow(HostValidationError);
    expect(() =>
      buildWindowsBatchEnvCommandLine("OPENDUCKTOR_WINDOWS_COMMAND", ["bad-name"]),
    ).toThrow(HostValidationError);
  });
});
