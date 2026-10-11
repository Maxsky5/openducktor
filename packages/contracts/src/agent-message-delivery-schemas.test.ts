import { describe, expect, test } from "bun:test";
import { agentMessageQueueManageInputSchema } from "./agent-message-delivery-schemas";

const target = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: "session-1",
  sessionScope: { kind: "repository" as const },
};
const slashCommand = {
  kind: "slash_command" as const,
  command: { id: "compact", trigger: "compact", title: "Compact", hints: [] },
};
const attachment = {
  kind: "attachment" as const,
  attachment: { id: "a-1", path: "/tmp/brief.pdf", name: "brief.pdf", kind: "pdf" as const },
};

describe("agent message delivery contracts", () => {
  test("rejects a slash command with attachments in an edit", () => {
    expect(
      agentMessageQueueManageInputSchema.safeParse({
        ...target,
        action: {
          kind: "save_edit",
          submissionId: "submission-1",
          editId: "edit-1",
          parts: [slashCommand, attachment],
        },
      }).success,
    ).toBe(false);
    expect(
      agentMessageQueueManageInputSchema.parse({
        ...target,
        action: {
          kind: "save_edit",
          submissionId: "submission-1",
          editId: "edit-1",
          parts: [attachment],
        },
      }).action,
    ).toMatchObject({ kind: "save_edit", editId: "edit-1" });
    expect(
      agentMessageQueueManageInputSchema.safeParse({
        ...target,
        action: { kind: "cancel_edit", submissionId: "submission-1" },
      }).success,
    ).toBe(false);
  });
});
