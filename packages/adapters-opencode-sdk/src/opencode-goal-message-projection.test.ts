import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo } from "@opencode/client";
import { projectMessage } from "./opencode-message-projection";

const synthetic = (
  fields: Partial<Extract<SessionMessageInfo, { type: "synthetic" }>>,
): SessionMessageInfo => ({
  id: "msg_goal",
  type: "synthetic",
  time: { created: 1_794_000_000_000 },
  text: "A goal is now active for this session.\n<untrusted_objective>\nShip &lt;v2&gt; &amp; docs\n</untrusted_objective>\nKeep working.",
  metadata: { source: "goal", goalID: "goal-1" },
  ...fields,
});

describe("OpenCode goal messages", () => {
  test("shows the message that starts a goal as the /goal message of the user", () => {
    expect(projectMessage(synthetic({ description: "Goal: Ship <v2> & docs" }))).toMatchObject({
      messageId: "msg_goal",
      role: "user",
      text: "/goal Ship <v2> & docs",
      displayParts: [{ kind: "text", text: "/goal Ship <v2> & docs" }],
    });
  });

  test("keeps a goal resume or continuation message as a system notice", () => {
    expect(projectMessage(synthetic({})).role).toBe("system");
  });
});
