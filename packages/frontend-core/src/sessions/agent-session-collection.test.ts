import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "../test-support/shared-test-fixtures";
import {
  areAgentSessionCollectionsEquivalent,
  areAgentSessionStatesEquivalent,
  createAgentSessionCollection,
  getAgentSession,
  listAgentSessions,
  removeAgentSession,
  replaceAgentSession,
  replaceAgentSessionByIdentity,
} from "./agent-session-collection";

describe("areAgentSessionStatesEquivalent", () => {
  const session = createAgentSessionFixture({ externalSessionId: "session-1" });

  test("treats the same object and a copy with the same values as equivalent", () => {
    expect(areAgentSessionStatesEquivalent(session, session)).toBe(true);
    expect(areAgentSessionStatesEquivalent(session, { ...session })).toBe(true);
  });

  test("finds a new value object and an added key", () => {
    const newMessages = { ...session, messages: { ...session.messages } };
    expect(areAgentSessionStatesEquivalent(session, newMessages)).toBe(false);
    const withExtraKey = { ...session, extraKey: undefined };
    expect(areAgentSessionStatesEquivalent(session, withExtraKey)).toBe(false);
    expect(areAgentSessionStatesEquivalent(withExtraKey, session)).toBe(false);
  });
});

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
