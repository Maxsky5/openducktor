import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import {
  createRepoScopedAgentSessionState,
  requireRepoScopedAgentSessionState,
} from "./repo-scoped-agent-session";

describe("repo-scoped-agent-session", () => {
  test("creates a repo-scoped session state with explicit repo identity", () => {
    const { repoPath: _repoPath, ...session } = createAgentSessionFixture();
    const repoScopedSession = createRepoScopedAgentSessionState(session, "/repo-a");

    expect(repoScopedSession.repoPath).toBe("/repo-a");
  });

  test("requires repo identity before using a session as repo-scoped", () => {
    const sessionWithoutRepoPath = { ...createAgentSessionFixture() } as Record<string, unknown>;
    delete sessionWithoutRepoPath.repoPath;

    expect(() => requireRepoScopedAgentSessionState(sessionWithoutRepoPath as never)).toThrow(
      "Agent session 'session-1' is missing repoPath metadata.",
    );
  });
});
