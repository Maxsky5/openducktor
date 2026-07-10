import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_COMMAND_CONTRACTS,
  CLAUDE_RUNTIME_HOST_COMMAND_NAMES,
  claudeSearchAgentFilesInputSchema,
} from "./claude-runtime-command-contracts";

describe("Claude runtime command contracts", () => {
  test("keeps public command contracts runtime-owned", () => {
    expect(CLAUDE_RUNTIME_HOST_COMMAND_NAMES.length).toBeGreaterThan(0);
    expect(
      CLAUDE_RUNTIME_HOST_COMMAND_NAMES.every((command) => command.startsWith("claude_runtime_")),
    ).toBe(true);
    expect(CLAUDE_RUNTIME_HOST_COMMAND_NAMES.some((command) => command.includes("agent_sdk"))).toBe(
      false,
    );
    expect(
      Object.values(CLAUDE_RUNTIME_COMMAND_CONTRACTS).some((contract) =>
        Object.keys(contract).includes("clientMethod"),
      ),
    ).toBe(false);
  });

  test("allows empty file-search queries for initial autocomplete", () => {
    expect(
      claudeSearchAgentFilesInputSchema.parse({
        repoPath: "/repo",
        runtimeKind: "claude",
        workingDirectory: "/repo",
        query: "",
      }),
    ).toEqual({
      repoPath: "/repo",
      runtimeKind: "claude",
      workingDirectory: "/repo",
      query: "",
    });
  });
});
