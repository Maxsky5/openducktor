import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey, matchesAgentSessionIdentity } from "./agent-session-identity";

describe("agent session identity", () => {
  test("uses runtime kind and normalized working directory with the external session id", () => {
    const identity = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: " /repo/worktree/// ",
    };

    expect(agentSessionIdentityKey(identity)).toBe("session-1\u0000opencode\u0000/repo/worktree");
  });

  test("matches only the canonical session identity", () => {
    const identity = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/worktree/",
    };

    expect(
      matchesAgentSessionIdentity(identity, {
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      }),
    ).toBe(true);
    expect(
      matchesAgentSessionIdentity(identity, {
        externalSessionId: "session-1",
        runtimeKind: "codex",
        workingDirectory: "/repo/worktree",
      }),
    ).toBe(false);
    expect(
      matchesAgentSessionIdentity(identity, {
        externalSessionId: "session-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo/other",
      }),
    ).toBe(false);
  });
});
