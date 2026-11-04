import { describe, expect, test } from "bun:test";
import { withOpenDucktorClaudeCodeEnv } from "./claude-code-process-env";

describe("withOpenDucktorClaudeCodeEnv", () => {
  test("replaces the inherited client identity and keeps other values", () => {
    expect(
      withOpenDucktorClaudeCodeEnv(
        {
          CLAUDE_AGENT_SDK_CLIENT_APP: "other-app",
          CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
          PATH: "/usr/bin",
        },
        "openducktor/runtime-probe",
      ),
    ).toEqual({
      CLAUDE_AGENT_SDK_CLIENT_APP: "openducktor/runtime-probe",
      CLAUDE_CODE_ARTIFACT: "0",
      CLAUDE_CODE_ENTRYPOINT: "openducktor",
      PATH: "/usr/bin",
    });
  });

  test("keeps the Artifact tool off unless the user turns it on", () => {
    expect(withOpenDucktorClaudeCodeEnv({}, "openducktor").CLAUDE_CODE_ARTIFACT).toBe("0");
    expect(
      withOpenDucktorClaudeCodeEnv({ CLAUDE_CODE_ARTIFACT: "1" }, "openducktor")
        .CLAUDE_CODE_ARTIFACT,
    ).toBe("1");
  });
});
