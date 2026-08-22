import { runtimeTypeName } from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { createAgentSessionActions } from "./handlers/session-actions";
import { createEnsureRuntime } from "./runtime/runtime";
import { createLoadSourceSession } from "./session-read-model/source-session-loader";

describe("agent-orchestrator/index", () => {
  test("exports orchestrator public internals", () => {
    expect(runtimeTypeName(createAgentSessionActions)).toBe("function");
    expect(runtimeTypeName(createLoadSourceSession)).toBe("function");
    expect(runtimeTypeName(createEnsureRuntime)).toBe("function");
  });
});
