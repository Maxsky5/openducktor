import { describe, expect, test } from "bun:test";
import type { V2Event } from "@opencode/client";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { ref } from "./opencode-v2.test-support";

const enqueued = (inboxID: string, seq: number): V2Event => ({
  id: `evt_${inboxID}`,
  type: "session.inbox.enqueued",
  created: seq,
  durable: { aggregateID: ref.externalSessionId, seq, version: 1 },
  data: {
    sessionID: ref.externalSessionId,
    inboxID,
    item: { type: "user", payload: { text: inboxID }, delivery: "queue" },
  },
});

const stateOf = (events: ReturnType<OpenCodeLiveMessageProjector["apply"]>) =>
  events.map((event) => (event.type === "user_message" ? event.state : event.type));

describe("OpenCode inbox read state", () => {
  test("shows an input that starts the turn of an idle session as read", () => {
    const projector = new OpenCodeLiveMessageProjector();

    expect(stateOf(projector.apply(enqueued("msg_first", 1), true))).toEqual(["read"]);
    // An input behind the first one waits until OpenCode delivers it.
    expect(stateOf(projector.apply(enqueued("msg_second", 2), true))).toEqual(["queued"]);
    expect(projector.acceptedUserMessage(ref.externalSessionId, "msg_first")?.state).toBe("read");
  });

  test("keeps an input that arrives while the session runs queued", () => {
    const projector = new OpenCodeLiveMessageProjector();

    expect(stateOf(projector.apply(enqueued("msg_steer", 1), false))).toEqual(["queued"]);
    expect(projector.acceptedUserMessage(ref.externalSessionId, "msg_steer")?.state).toBe("queued");
  });
});
