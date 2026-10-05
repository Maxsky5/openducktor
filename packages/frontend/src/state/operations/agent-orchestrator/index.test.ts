import { describe, expect, test } from "bun:test";
import { createAgentSessionActions } from "./handlers/session-actions";
import { createLoadSourceSession } from "./session-read-model/source-session-loader";

describe("agent-orchestrator/index", () => {
  test("exports orchestrator public internals", () => {
    expect(createAgentSessionActions).toBeInstanceOf(Function);
    expect(createLoadSourceSession).toBeInstanceOf(Function);
  });
});
