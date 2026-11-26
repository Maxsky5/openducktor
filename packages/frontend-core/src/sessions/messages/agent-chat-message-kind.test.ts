import { describe, expect, test } from "bun:test";
import { buildMessage } from "../../test-support/agent-chat-transcript-fixtures";
import {
  canCopyAssistantMessage,
  classifyAgentChatMessage,
  resolveInstructionsMessage,
} from "./agent-chat-message-kind";

const toolMessage = buildMessage("tool", "", {
  meta: {
    kind: "tool",
    partId: "part-1",
    callId: "call-1",
    tool: "odt_set_spec",
    toolType: "generic",
    status: "completed",
  },
});

describe("classifyAgentChatMessage", () => {
  test("tells workflow tool calls from regular tool calls", () => {
    const workflow = classifyAgentChatMessage({
      message: toolMessage,
      toolCallPresentation: { kind: "workflow", displayName: "Set spec", odtTool: null },
    });
    expect(workflow.isWorkflowToolMessage).toBe(true);
    expect(workflow.isRegularToolMessage).toBe(false);
    expect(workflow.isRichCardMessage).toBe(true);

    const regular = classifyAgentChatMessage({
      message: toolMessage,
      toolCallPresentation: { kind: "regular", displayName: "bash" },
    });
    expect(regular.isWorkflowToolMessage).toBe(false);
    expect(regular.isRegularToolMessage).toBe(true);
  });

  test("gives assistant messages their role and no shared header", () => {
    const kind = classifyAgentChatMessage({
      message: buildMessage("assistant", "Done", {
        meta: { kind: "assistant", agentRole: "build" },
      }),
      toolCallPresentation: null,
    });
    expect(kind.isAssistantMessage).toBe(true);
    expect(kind.assistantRole).toBe("build");
    expect(kind.showSharedHeader).toBe(false);
  });

  test("reads the system prompt body and hides the time of approximate timestamps", () => {
    const kind = classifyAgentChatMessage({
      message: buildMessage("system", "System prompt:\n\n  Follow the plan.", {
        timestampIsApproximate: true,
      }),
      toolCallPresentation: null,
    });
    expect(kind.isSystemPromptMessage).toBe(true);
    expect(kind.systemPromptBody).toBe("Follow the plan.");
    expect(kind.timeLabel).toBe("");
  });
});

describe("canCopyAssistantMessage", () => {
  test("allows a copy of a finished assistant message with text only", () => {
    const message = buildMessage("assistant", "Result");
    expect(canCopyAssistantMessage(message, false)).toBe(true);
    expect(canCopyAssistantMessage(message, true)).toBe(false);
    expect(canCopyAssistantMessage(buildMessage("assistant", "   "), false)).toBe(false);
    expect(canCopyAssistantMessage(buildMessage("user", "Hi"), false)).toBe(false);
  });
});

describe("resolveInstructionsMessage", () => {
  test("reads the system prompt", () => {
    expect(
      resolveInstructionsMessage(buildMessage("system", "System prompt:\n\nBody"), "Body"),
    ).toEqual({ toggleLabel: "Show system prompt", markdown: "Body" });
    expect(resolveInstructionsMessage(buildMessage("system", "Other"), "")).toBeNull();
  });
});
