import { describe, expect, test } from "bun:test";
import {
  agentSessionIdentityKey,
  matchesAgentSessionIdentity,
  parseAgentSessionIdentityKey,
} from "./agent-session-identity";

describe("agent session identity", () => {
  test("uses runtime kind and normalized working directory with the external session id", () => {
    const identity = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: " /repo/worktree/// ",
    };

    expect(agentSessionIdentityKey(identity)).toBe("session-1|opencode|%2Frepo%2Fworktree");
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

  test("parses a canonical session identity key", () => {
    expect(parseAgentSessionIdentityKey("session-1|codex|%2Frepo%2Fworktree")).toEqual({
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo/worktree",
    });
  });

  test("rejects malformed session identity keys", () => {
    expect(parseAgentSessionIdentityKey(null)).toBeNull();
    expect(parseAgentSessionIdentityKey("session-1")).toBeNull();
    expect(parseAgentSessionIdentityKey("session-1|unknown|%2Frepo")).toBeNull();
    expect(parseAgentSessionIdentityKey("session-1|codex|%E0%A4%A")).toBeNull();
  });
});
