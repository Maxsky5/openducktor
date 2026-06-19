import { describe, expect, test } from "bun:test";
import { listenToAgentSessionEvents } from "./events/session-events";
import { createAgentSessionActions } from "./handlers/session-actions";
import { createEnsureRuntime } from "./runtime/runtime";
import { createLoadSourceSession } from "./session-read-model/source-session-loader";

describe("agent-orchestrator/index", () => {
  test("exports orchestrator public internals", () => {
    expect(typeof createAgentSessionActions).toBe("function");
    expect(typeof createLoadSourceSession).toBe("function");
    expect(typeof listenToAgentSessionEvents).toBe("function");
    expect(typeof createEnsureRuntime).toBe("function");
  });
});
