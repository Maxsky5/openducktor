import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "../test-support/shared-test-fixtures";
import { areAgentSessionStatesEquivalent } from "./agent-session-collection";

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
