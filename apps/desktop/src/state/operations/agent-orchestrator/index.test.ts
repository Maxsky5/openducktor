import { describe, expect, test } from "bun:test";
import * as orchestrator from "./index";

describe("agent-orchestrator/index", () => {
  test("exports orchestrator public internals", () => {
    expect(typeof orchestrator.createAgentSessionActions).toBe("function");
    expect(typeof orchestrator.createLoadAgentSessions).toBe("function");
    expect(typeof orchestrator.attachAgentSessionListener).toBe("function");
    expect(typeof orchestrator.createEnsureRuntime).toBe("function");
    expect(typeof orchestrator.upsertMessage).toBe("function");
  });
});
