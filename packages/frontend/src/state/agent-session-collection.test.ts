import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "@/pages/agents/agent-studio-test-utils";
import {
  areAgentSessionCollectionsEquivalent,
  createAgentSessionCollection,
  getAgentSession,
  hasAgentSessionStateChanges,
  listAgentSessions,
  removeAgentSession,
  replaceAgentSession,
  replaceAgentSessionByIdentity,
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

  test("keeps the same collection when replacing with an equivalent session", () => {
    const original = createAgentSessionFixture({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      status: "idle",
    });
    const equivalent = { ...original };

    const collection = createAgentSessionCollection([original]);
    const nextCollection = replaceAgentSession(collection, equivalent);

    expect(nextCollection).toBe(collection);
    expect(getAgentSession(nextCollection, original)).toBe(original);
  });

  test("compares session state deletions as changes", () => {
    const current = createAgentSessionFixture({
      stopRequestedAt: "2026-03-01T09:00:00.000Z",
    });
    const next = { ...current };
    delete next.stopRequestedAt;

    expect(hasAgentSessionStateChanges(current, next)).toBe(true);
  });

  test("compares collections by session identity and state", () => {
    const original = createAgentSessionFixture({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      status: "idle",
    });
    const current = createAgentSessionCollection([original]);
    const equivalent = createAgentSessionCollection([{ ...original }]);
    const changed = createAgentSessionCollection([{ ...original, status: "running" }]);

    expect(areAgentSessionCollectionsEquivalent(current, equivalent)).toBe(true);
    expect(areAgentSessionCollectionsEquivalent(current, changed)).toBe(false);
  });

  test("moves a session when an update changes its identity fields", () => {
    const original = createAgentSessionFixture({
      externalSessionId: "external-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo-a",
      status: "idle",
    });
    const movedSession = {
      ...original,
      workingDirectory: "/repo-b",
      status: "running" as const,
    };

    const collection = createAgentSessionCollection([original]);
    const nextCollection = replaceAgentSessionByIdentity(collection, original, movedSession);

    expect(getAgentSession(nextCollection, original)).toBeNull();
    expect(getAgentSession(nextCollection, movedSession)).toBe(movedSession);
    expect(listAgentSessions(nextCollection)).toEqual([movedSession]);
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
