import { describe, expect, test } from "bun:test";
import {
  GOAL_SLASH_COMMAND,
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
} from "@openducktor/contracts";
import {
  draftSystemSlashCommandBlockedReason,
  requireSystemCommandSessionTarget,
} from "./system-slash-command-guard";

describe("system slash command guard", () => {
  test("blocks /compact and /goal without an existing session", () => {
    const compactDraft = {
      segments: [
        {
          id: "c1",
          kind: "slash_command" as const,
          command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
        },
      ],
      attachments: [],
    };
    const goalDraft = {
      segments: [
        { id: "g1", kind: "slash_command" as const, command: GOAL_SLASH_COMMAND },
        { id: "t1", kind: "text" as const, text: " finish tests" },
      ],
      attachments: [],
    };
    expect(draftSystemSlashCommandBlockedReason(compactDraft, false)).toContain("/compact");
    expect(draftSystemSlashCommandBlockedReason(goalDraft, false)).toContain("/goal");
    expect(draftSystemSlashCommandBlockedReason(compactDraft, true)).toBeNull();
    expect(draftSystemSlashCommandBlockedReason(goalDraft, true)).toBeNull();

    expect(() =>
      requireSystemCommandSessionTarget(
        [{ kind: "slash_command", command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND }],
        false,
      ),
    ).toThrow("/compact requires an existing selected session.");
  });

  test("allows ordinary text and non-system slash commands without a session", () => {
    const normalDraft = {
      segments: [{ id: "t1", kind: "text" as const, text: "Hello world" }],
      attachments: [],
    };
    expect(draftSystemSlashCommandBlockedReason(normalDraft, false)).toBeNull();
  });
});
