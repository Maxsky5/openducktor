import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { resolveAgentChatRuntimePresentation } from "./agent-chat-runtime-presentation";

describe("resolveAgentChatRuntimePresentation", () => {
  test("projects tool aliases and approval outcomes above the chat render tree", () => {
    expect(
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeKind: "opencode",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      workflowToolAliasesByCanonical: OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
      supportedApprovalReplyOutcomes:
        OPENCODE_RUNTIME_DESCRIPTOR.capabilities.approvals.supportedReplyOutcomes,
    });
  });

  test("keeps non-runtime chats explicit", () => {
    expect(
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeKind: null,
      }),
    ).toEqual({
      runtimeKind: null,
      supportedApprovalReplyOutcomes: null,
    });
  });
});
