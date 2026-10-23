import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { MessageBody } from "./agent-chat-message-card-content";
import { AgentChatForkActionsContext, type AgentChatForkActions } from "./agent-chat-fork-context";

function reply(
  message: Partial<AgentChatMessage> = {},
  streaming = false,
  actions: AgentChatForkActions | null = null,
) {
  return (
    <AgentChatForkActionsContext value={actions}>
      <MessageBody
        message={{
          id: "rendered-part",
          role: "assistant",
          content: "The final reply",
          timestamp: "2026-10-22T10:00:00.000Z",
          meta: { kind: "assistant", isFinal: true, forkPoint: { messageId: "native-message" } },
          ...message,
        }}
        modelCatalog={null}
        sessionRuntimeKind={null}
        parentSession={null}
        assistantAccentColor={undefined}
        isStreamingAssistantMessage={streaming}
        timeLabel=""
        systemPromptBody=""
        sessionWorkingDirectory={null}
        toolCallPresentation={null}
      />
    </AgentChatForkActionsContext>
  );
}

describe("final reply actions", () => {
  test("shows Copy and Fork together without model data and sends the native point", () => {
    const points: string[] = [];
    const view = render(
      reply({}, false, {
        disabledReason: null,
        isPending: () => false,
        onFork: (point) => {
          points.push(point.messageId);
        },
      }),
    );
    try {
      const copy = view.getByRole("button", { name: "Copy assistant message content" });
      const fork = view.getByRole("button", { name: "Fork from this reply" });
      expect(view.getAllByRole("button", { name: "Copy assistant message content" })).toHaveLength(
        1,
      );
      expect(copy.parentElement).toBe(fork.parentElement?.parentElement ?? null);
      fireEvent.click(fork);
      expect(points).toEqual(["native-message"]);
    } finally {
      view.unmount();
    }
  });

  test("keeps the disabled reason keyboard accessible and blocks pending repeats", async () => {
    let clicks = 0;
    const actions = {
      disabledReason: "Start Codex in Settings, then retry.",
      isPending: () => false,
      onFork: () => {
        clicks += 1;
      },
    };
    const view = render(reply({}, false, actions));
    try {
      const fork = view.getByRole("button", { name: "Fork from this reply" });
      expect(fork.hasAttribute("disabled")).toBe(true);
      const target = view.getByLabelText("Start Codex in Settings, then retry.");
      expect(target.tabIndex).toBe(0);
      fireEvent.focus(target);
      expect((await view.findByRole("tooltip")).textContent).toContain("Start Codex");
      view.rerender(reply({}, false, { ...actions, disabledReason: null, isPending: () => true }));
      fireEvent.click(view.getByRole("button", { name: "Fork from this reply" }));
      expect(view.getByLabelText("Forking chat…").tabIndex).toBe(0);
      expect(clicks).toBe(0);
    } finally {
      view.unmount();
    }
  });

  test("omits Fork without a completed point or root actions and hides Copy while streaming", () => {
    const actions = { disabledReason: null, isPending: () => false, onFork: () => {} };
    const view = render(reply({ meta: { kind: "assistant", isFinal: true } }, false, actions));
    try {
      expect(view.queryByRole("button", { name: "Fork from this reply" })).toBeNull();
      expect(view.getByRole("button", { name: "Copy assistant message content" })).toBeDefined();
      view.rerender(reply({}, false, null));
      expect(view.queryByRole("button", { name: "Fork from this reply" })).toBeNull();
      view.rerender(reply({ meta: { kind: "assistant", isFinal: false } }, true, actions));
      expect(view.queryByRole("button", { name: "Copy assistant message content" })).toBeNull();
      expect(view.queryByRole("button", { name: "Fork from this reply" })).toBeNull();
      view.rerender(reply({ meta: { kind: "assistant", isFinal: false } }, false, actions));
      expect(view.getByRole("button", { name: "Copy assistant message content" })).toBeDefined();
      expect(view.queryByRole("button", { name: "Fork from this reply" })).toBeNull();
    } finally {
      view.unmount();
    }
  });
});
