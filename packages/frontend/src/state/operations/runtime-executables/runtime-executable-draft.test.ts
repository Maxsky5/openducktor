import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_RUNTIMES, type RuntimeExecutableCheckResult } from "@openducktor/contracts";
import { replaceRuntimeExecutablePaths } from "./runtime-executable-draft";

describe("replaceRuntimeExecutablePaths", () => {
  test("replaces discovered paths while preserving runtime settings", () => {
    const runtimes = {
      ...DEFAULT_AGENT_RUNTIMES,
      opencode: { enabled: false, executablePath: "/old/opencode" },
      codex: {
        ...DEFAULT_AGENT_RUNTIMES.codex,
        enabled: true,
        executablePath: "/old/codex",
      },
      claude: { enabled: false, executablePath: "/old/claude" },
    };
    const results: RuntimeExecutableCheckResult[] = [
      {
        kind: "opencode",
        path: "/new/opencode",
        ok: true,
        version: "1.0.0",
        error: null,
      },
      {
        kind: "codex",
        path: "",
        ok: false,
        version: null,
        error: "Not found",
      },
      {
        kind: "claude",
        path: "/new/claude",
        ok: true,
        version: "1.0.0",
        error: null,
      },
    ];

    expect(replaceRuntimeExecutablePaths(runtimes, results)).toEqual({
      ...runtimes,
      opencode: { ...runtimes.opencode, executablePath: "/new/opencode" },
      codex: { ...runtimes.codex, executablePath: "" },
      claude: { ...runtimes.claude, executablePath: "/new/claude" },
    });
  });
});
