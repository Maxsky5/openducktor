import { expect, test } from "bun:test";
import { hasTemporaryWorktreeBranch } from "./workspace-session-branch-naming";

const id = "6c5fc6e8-fc64-4b0b-abe7-45b2e80fbf6c";
const record = (workingDirectory: string, branchName: string | null, lastActivityAt?: number) => {
  const session: Parameters<typeof hasTemporaryWorktreeBranch>[0] = {
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

test("finds the temporary branch of an unnamed worktree before its first message", () => {
  expect(hasTemporaryWorktreeBranch(record("/w/workspace-sessions/6c5fc6e8", "odt/6c5fc6e8"))).toBe(
    true,
  );
});

test("ignores a renamed branch, a typed folder, and a chat with activity", () => {
  expect(hasTemporaryWorktreeBranch(record("/w/workspace-sessions/6c5fc6e8", "fix/login"))).toBe(
    false,
  );
  expect(hasTemporaryWorktreeBranch(record("/w/workspace-sessions/login", "odt/6c5fc6e8"))).toBe(
    false,
  );
  expect(
    hasTemporaryWorktreeBranch(record("/w/workspace-sessions/6c5fc6e8", "odt/6c5fc6e8", 1)),
  ).toBe(false);
});
