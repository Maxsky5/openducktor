import { describe, expect, test } from "bun:test";
import {
  claudeDeniedActionConsent,
  claudeHistoryToolDenial,
  isClaudeDeniedActionConsent,
} from "./claude-agent-sdk-tool-denials";

describe("Claude tool denials", () => {
  test("grants a shell call as its whole command, as Claude Code does", () => {
    expect(
      claudeDeniedActionConsent({ toolName: "Bash", input: { command: 'git push -f "origin"' } }),
    ).toBe(
      'Permission granted for this exact command only, as one whole string: "git push -f \\"origin\\"". This does not approve any other command, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry this exact command if you would like.',
    );
  });

  test("grants another call by its tool and input", () => {
    expect(
      claudeDeniedActionConsent({ toolName: "WebFetch", input: { url: "https://example.com" } }),
    ).toStartWith(
      'Permission granted for this exact call only, as one whole string: "{\\"tool\\":\\"WebFetch\\",\\"input\\":{\\"url\\":\\"https://example.com\\"}}". This does not approve any other call,',
    );
  });

  test("names the server of an MCP tool, as Claude Code does", () => {
    expect(
      claudeDeniedActionConsent({ toolName: "mcp__github__create_issue", input: { title: "x" } }),
    ).toContain(
      '"{\\"server\\":\\"github\\",\\"tool\\":\\"create_issue\\",\\"input\\":{\\"title\\":\\"x\\"}}"',
    );
  });

  test("gives no consent for a call too long for Claude Code to offer Allow", () => {
    expect(
      claudeDeniedActionConsent({ toolName: "Write", input: { content: "a".repeat(5000) } }),
    ).toBeUndefined();
    expect(
      claudeDeniedActionConsent({ toolName: "Bash", input: { command: "a".repeat(5000) } }),
    ).toContain("this exact command");
  });

  test("recognizes only the exact consent text", () => {
    const consent = claudeDeniedActionConsent({ toolName: "Bash", input: { command: "ls\nrm x" } });
    expect(isClaudeDeniedActionConsent(consent ?? "")).toBe(true);
    expect(isClaudeDeniedActionConsent(`Please note: ${consent}`)).toBe(false);
    expect(isClaudeDeniedActionConsent("Permission granted for this exact command only")).toBe(
      false,
    );
  });

  test("escapes hidden characters but keeps plain spaces", () => {
    expect(
      claudeDeniedActionConsent({ toolName: "Bash", input: { command: "rm a​b c" } }),
    ).toContain('"rm a\\u200bb c"');
  });

  test("shows the classifier reason of an auto mode result, as the live denial does", () => {
    expect(
      claudeHistoryToolDenial(
        "automode-blocked",
        "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Destructive or Unwanted Actions]. If you have other tasks that don't depend on this action, continue working on those.",
      ),
    ).toEqual({ source: "auto_mode", reason: "[Destructive or Unwanted Actions]" });
  });

  test("maps only auto mode and rule denials of the transcript", () => {
    expect(claudeHistoryToolDenial("automode-blocked", "Blocked.")).toEqual({
      source: "auto_mode",
      reason: "Blocked.",
    });
    expect(claudeHistoryToolDenial("permission-rule", "Denied by rule.")).toEqual({
      source: "permission_settings",
      reason: "Denied by rule.",
    });
    expect(claudeHistoryToolDenial("user-rejected", "Rejected.")).toBeUndefined();
    expect(claudeHistoryToolDenial(undefined, "Failed.")).toBeUndefined();
  });
});
