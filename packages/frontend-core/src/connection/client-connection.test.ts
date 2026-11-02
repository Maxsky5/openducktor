import { afterEach, describe, expect, test } from "bun:test";
import { createTextSegment } from "../drafts/agent-chat-composer-draft";
import { AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES } from "../drafts/agent-chat-draft-storage";
import { createFeedbackFake } from "../test-support/feedback-fake";
import { createTestClientConnection } from "../test-support/test-client-connection";
import type { ClientConnection } from "./client-connection";

const identity = { workspaceId: "workspace", workspaceSessionId: "chat-1" };
const draftOf = (text: string) => ({
  segments: [createTextSegment(text, "text-1")],
  attachments: [],
});

const connections: ClientConnection[] = [];
const openConnection = () => {
  const feedback = createFeedbackFake();
  const connection = createTestClientConnection({ feedback, scheduleTask: () => () => {} });
  connections.push(connection);
  return { connection, feedback };
};

afterEach(async () => {
  for (const connection of connections) connection.drafts.chat.clear(identity);
  await Promise.all(connections.splice(0).map((connection) => connection.dispose()));
});

describe("client connection chat drafts", () => {
  test("tells the user on each save that a long draft is not kept", async () => {
    const { connection, feedback } = openConnection();
    const long = "x".repeat(AGENT_CHAT_DRAFT_STORAGE_MAX_BYTES);

    connection.drafts.chat.set(identity, null, draftOf(long));
    await connection.drafts.chat.flush(identity);
    connection.drafts.chat.set(identity, null, draftOf(`${long}y`));
    await connection.drafts.chat.flush(identity);

    const warnings = feedback.shownOf("warning");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toBe("This chat draft is too long to keep on this device");
    expect(warnings[0]?.options?.description).toBe(
      "The app does not save drafts over 20 KB. Shorten the draft or send it before you close the app.",
    );
    // Both saves use one message ID, so the second message replaces the first.
    expect(warnings[1]?.options?.id).toBe(warnings[0]?.options?.id);
    expect(connection.drafts.chat.hydrate(identity, null)).toEqual(draftOf(`${long}y`));
  });

  test("saves a draft under the limit without a message", async () => {
    const { connection, feedback } = openConnection();

    connection.drafts.chat.set(identity, null, draftOf("Short draft"));
    await connection.drafts.chat.flush(identity);

    expect(feedback.shown).toEqual([]);
  });
});
