import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo } from "@opencode/client";
import { AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX } from "@openducktor/core";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { projectMessages } from "./opencode-message-projection";
import { durable } from "./opencode-v2-live.test-support";
import { ref } from "./opencode-v2.test-support";

describe("OpenCode V2 system content", () => {
  test("shows activated skills as tool cards with their full content available", () => {
    const message: SessionMessageInfo = {
      id: "msg_skill",
      type: "skill",
      skill: "native.review",
      name: "review",
      text: "# Review instructions\n\nCheck the native contract.",
      time: { created: 2 },
    };
    expect(projectMessages([message])).toMatchObject([
      {
        role: "assistant",
        text: "",
        parts: [
          {
            kind: "tool",
            tool: "skill",
            status: "completed",
            input: { name: "review" },
            output: message.text,
          },
        ],
      },
    ]);
    const live = new OpenCodeLiveMessageProjector();
    const events = live.apply({
      id: "evt_skill",
      type: "session.skill.activated",
      created: 2,
      durable,
      data: {
        sessionID: ref.externalSessionId,
        id: message.skill,
        name: message.name,
        text: message.text,
      },
    });
    const restored = new OpenCodeLiveMessageProjector();
    restored.seed([message]);
    expect(events).toEqual(restored.snapshotEvents(ref.externalSessionId));
  });

  test("uses the collapsed instruction display for files loaded during a session", () => {
    const message: SessionMessageInfo = {
      id: "msg_loaded_instructions",
      type: "synthetic",
      time: { created: 3 },
      description: "Loaded packages/AGENTS.md",
      text: "Instructions from: /repo/packages/AGENTS.md\nUse the package rules.",
      metadata: { instruction: { paths: ["/repo/packages/AGENTS.md"] } },
    };
    const expected = `${AGENT_SESSION_INSTRUCTIONS_UPDATE_PREFIX}${message.text}`;
    expect(projectMessages([message])[0]).toMatchObject({ role: "system", text: expected });
    const live = new OpenCodeLiveMessageProjector();
    expect(
      live.apply({
        id: "evt_loaded_instructions",
        type: "session.synthetic",
        created: 3,
        durable,
        data: {
          sessionID: ref.externalSessionId,
          text: message.text,
          description: message.description,
          metadata: message.metadata,
        },
      }),
    ).toMatchObject([{ type: "session_policy_notice", message: expected }]);
  });

  test("keeps unknown notices and user text that looks like shell markup", () => {
    const text =
      '<shell id="sh_checks" state="completed" command="bun run test">\nVisible example\n</shell>';
    const messages: SessionMessageInfo[] = [
      {
        id: "msg_plugin",
        type: "synthetic",
        time: { created: 1 },
        text,
        metadata: { source: "plugin" },
      },
      { id: "msg_user", type: "user", time: { created: 2 }, text },
    ];
    expect(projectMessages(messages)).toMatchObject([
      { messageId: "msg_plugin", role: "system", text },
      { messageId: "msg_user", role: "user", text },
    ]);
  });
});
