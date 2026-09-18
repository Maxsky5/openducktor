import { describe, expect, test } from "bun:test";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { createSessionHistoryReadGeneration } from "./session-history-read-generation";

const sessionTarget: AgentSessionIdentity = {
  externalSessionId: "external-1",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
};

const otherSessionTarget: AgentSessionIdentity = {
  ...sessionTarget,
  externalSessionId: "external-2",
};

describe("session history read generation", () => {
  test("keeps only the latest started read for a session", () => {
    const generation = createSessionHistoryReadGeneration();
    const firstRead = generation.begin(sessionTarget);
    const secondRead = generation.begin(sessionTarget);

    expect(generation.isLatest(sessionTarget, firstRead)).toBe(false);
    expect(generation.isLatest(sessionTarget, secondRead)).toBe(true);
  });

  test("orders reads per session identity", () => {
    const generation = createSessionHistoryReadGeneration();
    const sessionRead = generation.begin(sessionTarget);
    generation.begin(otherSessionTarget);

    expect(generation.isLatest(sessionTarget, sessionRead)).toBe(true);
  });

  test("does not release the latest read when a superseded read finishes", () => {
    const generation = createSessionHistoryReadGeneration();
    const firstRead = generation.begin(sessionTarget);
    const secondRead = generation.begin(sessionTarget);

    generation.finish(sessionTarget, firstRead);

    expect(generation.isLatest(sessionTarget, secondRead)).toBe(true);
  });

  test("stops reporting a finished read as the latest", () => {
    const generation = createSessionHistoryReadGeneration();
    const firstRead = generation.begin(sessionTarget);
    generation.finish(sessionTarget, firstRead);

    expect(generation.isLatest(sessionTarget, firstRead)).toBe(false);
  });
});
