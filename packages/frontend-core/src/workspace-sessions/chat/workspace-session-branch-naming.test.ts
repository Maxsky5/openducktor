import { expect, test } from "bun:test";
import { BRANCH_NAMING_NOTICE, branchNamingNotice } from "./workspace-session-branch-naming";

const id = "1a2b3c4d-0000-4000-8000-000000000000";
const chat = (branchName: string) => ({
  id,
  executionTarget: {
    kind: "local_worktree" as const,
    workingDirectory: "/w/workspace-sessions/1a2b3c4d",
    branchName,
    worktreeState: "present" as const,
  },
});
const sending = { pendingUserMessageStartedAt: 1 };

test("shows the naming notice while the first message of an automatic branch waits", () => {
  expect(branchNamingNotice(chat("odt/1a2b3c4d"), sending)).toBe(BRANCH_NAMING_NOTICE);
});

test("shows no naming notice before the send or after the host saves the final branch", () => {
  expect(branchNamingNotice(chat("odt/1a2b3c4d"), { pendingUserMessageStartedAt: undefined })).toBe(
    null,
  );
  expect(branchNamingNotice(chat("odt/1a2b3c4d"), null)).toBe(null);
  expect(branchNamingNotice(chat("fix/login"), sending)).toBe(null);
});
