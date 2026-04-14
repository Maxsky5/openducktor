import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import { toAgentSessionSummary } from "./agent-sessions-store";

describe("toAgentSessionSummary", () => {
  test("preserves runId for build-session consumers", () => {
    const session = createAgentSessionFixture({
      role: "build",
      runId: "run-24",
      workingDirectory: "/repo",
    });

    expect(toAgentSessionSummary(session)).toMatchObject({
      sessionId: session.sessionId,
      role: "build",
      runId: "run-24",
      workingDirectory: "/repo",
    });
  });
});
