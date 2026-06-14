import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import {
  createAgentSessionCollection,
  getAgentSession,
  getAgentSessionByExternalSessionId,
  listAgentSessions,
  removeAgentSession,
  replaceAgentSession,
} from "./agent-session-collection";

describe("agent-session-collection", () => {
  test("replaces only the matching session identity", () => {
    const original = createAgentSessionFixture({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      status: "idle",
    });
    const sameExternalIdOtherWorktree = createAgentSessionFixture({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-b",
      status: "running",
    });
    const updatedOriginal = { ...original, status: "stopped" as const };

    const collection = createAgentSessionCollection([original, sameExternalIdOtherWorktree]);
    const nextCollection = replaceAgentSession(collection, updatedOriginal);

    expect(getAgentSession(nextCollection, original)?.status).toBe("stopped");
    expect(getAgentSession(nextCollection, sameExternalIdOtherWorktree)?.status).toBe("running");
    expect(listAgentSessions(nextCollection)).toHaveLength(2);
  });

  test("keeps external-id-only lookup fail-fast when the id is ambiguous", () => {
    const collection = createAgentSessionCollection([
      createAgentSessionFixture({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo-a",
      }),
      createAgentSessionFixture({
        externalSessionId: "external-1",
        runtimeKind: "opencode",
        workingDirectory: "/repo-b",
      }),
    ]);

    expect(() => getAgentSessionByExternalSessionId(collection, "external-1")).toThrow(
      "Session 'external-1' is duplicated in the local session collection.",
    );
  });

  test("removes only the matching session identity", () => {
    const removedSession = createAgentSessionFixture({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
    });
    const keptSession = createAgentSessionFixture({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-b",
    });

    const collection = createAgentSessionCollection([removedSession, keptSession]);
    const nextCollection = removeAgentSession(collection, removedSession);

    expect(getAgentSession(nextCollection, removedSession)).toBeNull();
    expect(getAgentSession(nextCollection, keptSession)).toBe(keptSession);
  });
});
