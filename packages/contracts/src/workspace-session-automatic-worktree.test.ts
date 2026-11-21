import { expect, test } from "bun:test";
import {
  automaticWorktreeName,
  hasAutomaticWorktreeBranch,
} from "./workspace-session-automatic-worktree";

const id = "1a2b3c4d-0000-4000-8000-000000000000";
const chat = (workingDirectory: string, branchName: string | null, lastActivityAt?: number) => {
  const session: Parameters<typeof hasAutomaticWorktreeBranch>[0] = {
    id,
    executionTarget: {
      kind: "local_worktree",
      workingDirectory,
      branchName,
      worktreeState: "present",
    },
  };
  if (lastActivityAt !== undefined) session.lastActivityAt = lastActivityAt;
  return session;
};

test("the automatic name is the first eight digits of the session ID", () => {
  expect(automaticWorktreeName(id)).toBe("1a2b3c4d");
});

test("finds the automatic branch of an unnamed worktree with any prefix", () => {
  expect(hasAutomaticWorktreeBranch(chat("/w/workspace-sessions/1a2b3c4d", "odt/1a2b3c4d"))).toBe(
    true,
  );
  expect(hasAutomaticWorktreeBranch(chat("/w/workspace-sessions/1a2b3c4d", "old/1a2b3c4d"))).toBe(
    true,
  );
});

test("ignores a named branch, a typed folder, and a chat with activity", () => {
  expect(hasAutomaticWorktreeBranch(chat("/w/workspace-sessions/1a2b3c4d", "fix/login"))).toBe(
    false,
  );
  expect(hasAutomaticWorktreeBranch(chat("/w/workspace-sessions/login", "odt/1a2b3c4d"))).toBe(
    false,
  );
  expect(
    hasAutomaticWorktreeBranch(chat("/w/workspace-sessions/1a2b3c4d", "odt/1a2b3c4d", 1)),
  ).toBe(false);
});
