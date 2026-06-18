import { describe, expect, test } from "bun:test";
import { hasSameAgentSessionIdentity } from "./agent-session-identity";

const identity = {
  externalSessionId: "session-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
};

describe("hasSameAgentSessionIdentity", () => {
  test("matches by external session id, runtime kind, and normalized working directory", () => {
    expect(
      hasSameAgentSessionIdentity(
        {
          externalSessionId: " session-1 ",
          runtimeKind: " opencode ",
          workingDirectory: "/repo/worktree/",
        },
        identity,
      ),
    ).toBe(true);
  });

  test("rejects sessions with the same external id but a different working directory", () => {
    expect(
      hasSameAgentSessionIdentity(identity, {
        ...identity,
        workingDirectory: "/repo/other-worktree",
      }),
    ).toBe(false);
  });
});
