import { describe, expect, test } from "bun:test";
import type { SessionPart } from "./session-event-types";
import { resolveToolRefreshDecision } from "./session-tool-parts";

const buildToolPart = (tool: string): Extract<SessionPart, { kind: "tool" }> => {
  return {
    kind: "tool",
    messageId: "msg-1",
    partId: "part-1",
    callId: "call-1",
    tool,
    status: "pending",
    output: "",
    error: "",
  };
};

describe("session-tool-parts", () => {
  test("resolveToolRefreshDecision only triggers on first completion transition", () => {
    const cases = [
      {
        name: "workflow mutation first completion",
        tool: "odt_set_plan",
        status: "completed",
        previousStatus: "pending",
        expected: { shouldRefreshTaskData: true },
      },
      {
        name: "workflow mutation duplicate completion",
        tool: "odt_set_plan",
        status: "completed",
        previousStatus: "completed",
        expected: { shouldRefreshTaskData: false },
      },
      {
        name: "todo first completion",
        tool: "todowrite",
        status: "completed",
        previousStatus: "pending",
        expected: { shouldRefreshTaskData: false },
      },
      {
        name: "todo duplicate completion",
        tool: "todowrite",
        status: "completed",
        previousStatus: "completed",
        expected: { shouldRefreshTaskData: false },
      },
      {
        name: "non-completed status",
        tool: "todowrite",
        status: "running",
        previousStatus: "pending",
        expected: { shouldRefreshTaskData: false },
      },
    ] as const;

    for (const scenario of cases) {
      const decision = resolveToolRefreshDecision(
        buildToolPart(scenario.tool),
        scenario.status,
        scenario.previousStatus,
      );
      expect(decision).toEqual(scenario.expected);
    }
  });
});
