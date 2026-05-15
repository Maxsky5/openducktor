import { describe, expect, test } from "bun:test";
import { attachAgentSessionListener } from "./events/session-events";
import { createAgentSessionActions } from "./handlers/session-actions";
import { createLoadAgentSessions } from "./lifecycle/load-sessions";
import { createEnsureRuntime } from "./runtime/runtime";
import { upsertMessage } from "./support/utils";

describe("agent-orchestrator/index", () => {
  test("exports orchestrator public internals", () => {
    expect(typeof createAgentSessionActions).toBe("function");
    expect(typeof createLoadAgentSessions).toBe("function");
    expect(typeof attachAgentSessionListener).toBe("function");
    expect(typeof createEnsureRuntime).toBe("function");
    expect(typeof upsertMessage).toBe("function");
  });
});
