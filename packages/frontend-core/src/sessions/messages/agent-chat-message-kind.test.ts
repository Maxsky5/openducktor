import { describe, expect, test } from "bun:test";
import { AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX } from "@openducktor/core";
import { buildMessage } from "../../test-support/agent-chat-transcript-fixtures";
import {
  canCopyAssistantMessage,
  classifyAgentChatMessage,
  resolveInstructionsMessage,
} from "./agent-chat-message-kind";
import { SYSTEM_PROMPT_PREFIX } from "./message-formatting";

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
      toolCallPresentation: { kind: "workflow", displayName: "Set spec" },
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
      message: buildMessage("system", `${SYSTEM_PROMPT_PREFIX}  Follow the plan.`, {
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
  test("reads system prompts and instruction updates", () => {
    expect(
      resolveInstructionsMessage(buildMessage("system", `${SYSTEM_PROMPT_PREFIX}Body`), "Body"),
    ).toEqual({ kind: "system_prompt", toggleLabel: "Show system prompt", markdown: "Body" });
    expect(
      resolveInstructionsMessage(
        buildMessage("system", `${AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX}New rules`),
        "",
      ),
    ).toEqual({
      kind: "instruction_update",
      toggleLabel: "Show instruction update",
      markdown: "New rules",
    });
    expect(resolveInstructionsMessage(buildMessage("system", "Other"), "")).toBeNull();
  });
});
