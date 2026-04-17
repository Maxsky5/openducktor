import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { createRepoScopedAgentSessionState } from "./repo-scoped-agent-session";

describe("repo-scoped-agent-session", () => {
  test("creates a repo-scoped session state with explicit repo identity", () => {
    const { repoPath: _repoPath, ...session } = createAgentSessionFixture();
    const repoScopedSession = createRepoScopedAgentSessionState(session, "/repo-a");

    expect(repoScopedSession.repoPath).toBe("/repo-a");
  });
});
