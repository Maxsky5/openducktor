import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  type AgentChatComposerDraft,
  createTextSegment,
} from "../../drafts/agent-chat-composer-draft";
import { promoteTypedGoalCommand } from "./goal-send-rules";

const typed = (text: string): AgentChatComposerDraft => ({ segments: [createTextSegment(text)] });

describe("promoteTypedGoalCommand", () => {
  test("turns a typed /goal into the system command", () => {
    const draft = promoteTypedGoalCommand(
      typed("/goal Ship the feature"),
      OPENCODE_RUNTIME_DESCRIPTOR,
      "2.2.5",
    );

    expect(draft.segments).toMatchObject([
      { kind: "slash_command", command: { id: "system:goal" } },
      { kind: "text", text: "Ship the feature" },
    ]);
  });

  test("keeps the text where the runtime has no goals or the word only starts with goal", () => {
    const older = typed("/goal Ship");
    expect(promoteTypedGoalCommand(older, OPENCODE_RUNTIME_DESCRIPTOR, "2.2.0")).toBe(older);
    const other = typed("/goals Ship");
    expect(promoteTypedGoalCommand(other, OPENCODE_RUNTIME_DESCRIPTOR, "2.2.5")).toBe(other);
  });
});
