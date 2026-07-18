import { describe, expect, test } from "bun:test";
import { formatTerminalPathInput } from "./terminal-path-input";

describe("formatTerminalPathInput", () => {
  test("quotes paths using the terminal's actual POSIX shell", () => {
    expect(formatTerminalPathInput("/bin/zsh", ["/tmp/first image.png", "/tmp/it's.png"])).toBe(
      "'/tmp/first image.png' '/tmp/it'\\''s.png'",
    );
  });

  test("quotes paths using PowerShell syntax", () => {
    expect(
      formatTerminalPathInput("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["C:\\Temp\\it's.png"]),
    ).toBe("'C:\\Temp\\it''s.png'");
  });

  test("quotes paths using cmd syntax", () => {
    expect(formatTerminalPathInput("C:\\Windows\\System32\\cmd.exe", ["C:\\Temp\\image.png"])).toBe(
      '"C:\\Temp\\image.png"',
    );
  });

  test("rejects shell families whose escaping contract is unknown", () => {
    expect(() => formatTerminalPathInput("/opt/custom/bin/my-shell", ["/tmp/image.png"])).toThrow(
      "Unsupported terminal shell",
    );
  });
});
