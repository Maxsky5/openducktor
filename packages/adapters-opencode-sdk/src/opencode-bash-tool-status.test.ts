import { describe, expect, test } from "bun:test";
import type { SessionMessageAssistant, V2Event } from "@opencode/client";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { projectMessages } from "./opencode-message-projection";
import { model, ref } from "./opencode-v2.test-support";

const running = (): SessionMessageAssistant => ({
  id: "msg_bash",
  type: "assistant",
  agent: "build",
  model,
  time: { created: 1 },
  content: [
    {
      type: "tool",
      id: "call_bash",
      name: "bash",
      time: { created: 2, ran: 3 },
      state: { status: "running", input: { command: "pnpm test" }, metadata: {} },
    },
  ],
});

const completed = (exit: number): SessionMessageAssistant => ({
  ...running(),
  content: [
    {
      type: "tool",
      id: "call_bash",
      name: "bash",
      time: { created: 2, ran: 3, completed: 4 },
      state: {
        status: "completed",
        input: { command: "pnpm test" },
        content: [{ type: "text", text: "1 test failed" }],
        metadata: { exit },
      },
    },
  ],
});

const success = (exit: number): V2Event => ({
  id: "evt_bash",
  type: "session.tool.success",
  created: 4,
  durable: { aggregateID: ref.externalSessionId, seq: 1, version: 1 },
  data: {
    sessionID: ref.externalSessionId,
    assistantMessageID: "msg_bash",
    id: "call_bash",
    content: [{ type: "text", text: "1 test failed" }],
    metadata: { exit },
    executed: true,
  },
});

describe("OpenCode shell tool status", () => {
  test("fails a shell call that exits with an error code, in live events and loaded history", () => {
    const projector = new OpenCodeLiveMessageProjector();
    projector.seed([running()]);
    const failed = {
      status: "error",
      error: "Shell command exited with code 1.",
      output: "1 test failed",
      metadata: { exit: 1 },
    };

    expect(projector.apply(success(1))).toMatchObject([{ type: "assistant_part", part: failed }]);
    expect(projectMessages([completed(1)])[0]?.parts[0]).toMatchObject(failed);
  });

  test("keeps a shell call that exits with code 0 completed", () => {
    const part = projectMessages([completed(0)])[0]?.parts[0];

    expect(part).toMatchObject({ status: "completed", metadata: { exit: 0 } });
    expect(part).not.toHaveProperty("error");
  });
});
