import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { resolveAgentChatRuntimePresentation } from "./agent-chat-runtime-presentation";

describe("resolveAgentChatRuntimePresentation", () => {
  test.each(["codex", "claude"] as const)(
    "uses task names for %s even when the runtime supplies a raw label",
    (runtimeKind) => {
      const presentation = resolveAgentChatRuntimePresentation({
        runtimeDefinitions: [],
        runtimeKind,
      });
      for (const name of ["create_task", "search_tasks", "update_task"] as const) {
        const raw = runtimeKind === "claude" ? `mcp__openducktor__odt_${name}` : `odt_${name}`;
        expect(presentation.presentToolCall(raw, raw)).toEqual({
          kind: "task",
          displayName: name,
          taskTool: name,
        });
      }
    },
  );
  test.each(["create_task", "search_tasks", "update_task"])(
    "presents %s as a dedicated task tool",
    (name) => {
      const presentation = resolveAgentChatRuntimePresentation({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeKind: "opencode",
      });
      for (const toolName of [
        `odt_${name}`,
        `openducktor_odt_${name}`,
        `functions.openducktor_odt_${name}`,
      ]) {
        expect(presentation.presentToolCall(toolName)).toEqual({
          kind: "task",
          displayName: name,
          taskTool: name,
        });
      }
      expect(presentation.presentToolCall(`other_server.odt_${name}`).kind).toBe("regular");
    },
  );
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
    expect(presentation.presentToolCall("bash", "   ")).toEqual({
      kind: "regular",
      displayName: "bash",
    });
    expect(presentation.presentToolCall("openducktor_odt_set_plan", "Plan update")).toEqual({
      kind: "workflow",
      displayName: "Plan update",
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
    expect(presentation.presentToolCall("odt_build_completed")).toEqual({
      kind: "workflow",
      displayName: "build_completed",
    });
  });

  test("keeps approval outcomes absent when the runtime definition is unavailable", () => {
    const presentation = resolveAgentChatRuntimePresentation({
      runtimeDefinitions: [],
      runtimeKind: "codex",
    });

    expect(presentation.supportedApprovalReplyOutcomes).toBeNull();
  });
});
