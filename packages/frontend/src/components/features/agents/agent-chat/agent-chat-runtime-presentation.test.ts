import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { resolveAgentChatRuntimePresentation } from "./agent-chat-runtime-presentation";

describe("resolveAgentChatRuntimePresentation", () => {
  test("projects tool presentation and approval outcomes above the chat render tree", () => {
    const presentation = resolveAgentChatRuntimePresentation({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeKind: "opencode",
    });

    expect(presentation.runtimeKind).toBe("opencode");
    expect(presentation.supportedApprovalReplyOutcomes).toEqual(
      OPENCODE_RUNTIME_DESCRIPTOR.capabilities.approvals.supportedReplyOutcomes,
    );
    expect(presentation.presentToolCall("openducktor_odt_set_spec")).toEqual({
      kind: "workflow",
      displayName: "set_spec",
    });
    expect(presentation.presentToolCall("bash", "Shell command")).toEqual({
      kind: "regular",
      displayName: "Shell command",
    });
  });

  test("keeps non-runtime chats explicit", () => {
    const presentation = resolveAgentChatRuntimePresentation({
      runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      runtimeKind: null,
    });

    expect(presentation.runtimeKind).toBeNull();
    expect(presentation.supportedApprovalReplyOutcomes).toBeNull();
    expect(presentation.presentToolCall("custom_tool")).toEqual({
      kind: "regular",
      displayName: "custom_tool",
    });
  });
});
