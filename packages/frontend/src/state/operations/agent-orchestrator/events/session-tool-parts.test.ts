import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
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
    const cases: Array<{
      name: string;
      tool: string;
      status: Extract<SessionPart, { kind: "tool" }>["status"];
      previousStatus: Extract<SessionPart, { kind: "tool" }>["status"];
      aliases?: typeof OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical;
      expected: { shouldRefreshTaskData: boolean };
    }> = [
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
        name: "trusted runtime alias first completion",
        tool: "openducktor_odt_set_plan",
        status: "completed",
        previousStatus: "pending",
        aliases: OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
        expected: { shouldRefreshTaskData: true },
      },
      {
        name: "incorrect-case runtime alias stays unrecognized",
        tool: "OpenDucktor_ODT_SET_PLAN",
        status: "completed",
        previousStatus: "pending",
        aliases: OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
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

    for (const testCase of cases) {
      const decision = resolveToolRefreshDecision(
        buildToolPart(testCase.tool),
        testCase.status,
        testCase.previousStatus,
        testCase.aliases,
      );
      expect(decision).toEqual(testCase.expected);
    }
  });
});
