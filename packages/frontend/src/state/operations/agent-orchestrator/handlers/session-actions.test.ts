import { describe, expect, test } from "bun:test";
import { createSessionActions } from "./session-actions.test-helpers";

describe("agent-orchestrator/handlers/session-actions", () => {
  test("returns action handlers", () => {
    const actions = createSessionActions({ updateSession: () => null });

    expect(actions.sendAgentMessage).toBeInstanceOf(Function);
    expect(actions.stopAgentSession).toBeInstanceOf(Function);
  });
});
