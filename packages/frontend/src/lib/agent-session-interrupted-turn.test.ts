import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import {
  canResumeInterruptedTurn,
  hasUnfinishedLatestTurn,
} from "./agent-session-interrupted-turn";

const message = (
  input: Partial<AgentChatMessage> & Pick<AgentChatMessage, "role">,
): AgentChatMessage => ({
  id: `message-${input.role}-${input.content ?? ""}`,
  content: "",
  timestamp: "2026-07-17T10:00:00.000Z",
  ...input,
});

const userMessage = message({
  role: "user",
  content: "Fix the build",
  meta: { kind: "user", state: "read" },
});
const assistantDraft = message({
  role: "assistant",
  content: "Working",
  meta: { kind: "assistant", isFinal: false },
});
const assistantFinal = message({
  role: "assistant",
  content: "Done",
  meta: { kind: "assistant", isFinal: true },
});
const toolOutput = message({
  role: "tool",
  meta: {
    kind: "tool",
    partId: "part-1",
    callId: "call-1",
    tool: "bash",
    toolType: "bash",
    status: "completed",
  },
});

const resumableDescriptor = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
    sessionLifecycle: {
      ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
      supportsInterruptedTurnResume: true,
    },
  },
};
const nonResumableDescriptor = {
  ...resumableDescriptor,
  capabilities: {
    ...resumableDescriptor.capabilities,
    sessionLifecycle: {
      ...resumableDescriptor.capabilities.sessionLifecycle,
      supportsInterruptedTurnResume: false,
    },
  },
};

describe("hasUnfinishedLatestTurn", () => {
  test("reports an unfinished turn for a trailing user message", () => {
    expect(hasUnfinishedLatestTurn([assistantFinal, userMessage])).toBe(true);
  });

  test("reports an unfinished turn for a partial assistant reply after tool output", () => {
    expect(hasUnfinishedLatestTurn([userMessage, toolOutput, assistantDraft])).toBe(true);
  });

  test("ignores tool output, notices, and earlier turns", () => {
    expect(hasUnfinishedLatestTurn([])).toBe(false);
    expect(hasUnfinishedLatestTurn([userMessage, assistantFinal, toolOutput])).toBe(false);
    expect(
      hasUnfinishedLatestTurn([userMessage, assistantFinal, userMessage, assistantFinal]),
    ).toBe(false);
  });

  test("treats a system notice after an unfinished turn as a continuation candidate", () => {
    expect(
      hasUnfinishedLatestTurn([userMessage, message({ role: "system", content: "Interrupted" })]),
    ).toBe(true);
  });
});

describe("canResumeInterruptedTurn", () => {
  test("requires an inactive session, a capability, and an unfinished turn", () => {
    expect(
      canResumeInterruptedTurn({
        activityState: "error",
        messages: [userMessage],
        runtimeDescriptor: resumableDescriptor,
      }),
    ).toBe(true);
  });

  test("rejects active sessions", () => {
    for (const activityState of ["starting", "running", "waiting_input"] as const) {
      expect(
        canResumeInterruptedTurn({
          activityState,
          messages: [userMessage],
          runtimeDescriptor: resumableDescriptor,
        }),
      ).toBe(false);
    }
  });

  test("rejects a runtime without the capability and an unknown descriptor", () => {
    expect(
      canResumeInterruptedTurn({
        activityState: "idle",
        messages: [userMessage],
        runtimeDescriptor: nonResumableDescriptor,
      }),
    ).toBe(false);
    expect(
      canResumeInterruptedTurn({
        activityState: "idle",
        messages: [userMessage],
        runtimeDescriptor: null,
      }),
    ).toBe(false);
  });

  test("rejects a finished transcript", () => {
    expect(
      canResumeInterruptedTurn({
        activityState: "idle",
        messages: [userMessage, assistantFinal],
        runtimeDescriptor: resumableDescriptor,
      }),
    ).toBe(false);
  });
});
