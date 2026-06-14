import { describe, expect, test } from "bun:test";
import { isAgentSessionWorkingStatus } from "./agent-session-status";

describe("agent-session-status", () => {
  test("treats only starting and running sessions as working", () => {
    expect(isAgentSessionWorkingStatus("starting")).toBe(true);
    expect(isAgentSessionWorkingStatus("running")).toBe(true);
    expect(isAgentSessionWorkingStatus("idle")).toBe(false);
    expect(isAgentSessionWorkingStatus("stopped")).toBe(false);
    expect(isAgentSessionWorkingStatus("error")).toBe(false);
  });
});
