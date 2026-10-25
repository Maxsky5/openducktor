import { expect, test } from "bun:test";
import {
  worktreeExecutionTarget,
  workspaceSessionRecord,
} from "../../test-support/workspace-session-fixtures";
import {
  forkSourceFolder,
  initialForkWorktree,
  workspaceSessionForkInput,
} from "./workspace-session-fork-form";

const point = { messageId: "message-1" };
const repoChat = workspaceSessionRecord("repo");
const worktreeChat = workspaceSessionRecord("tree", {
  executionTarget: worktreeExecutionTarget({ branchName: "odt/chat" }),
});

test("describes the source folder of a chat, with the branch of a worktree", () => {
  expect(forkSourceFolder(repoChat)).toEqual({
    name: "alpha",
    directory: "/repos/alpha",
    branchName: null,
  });
  expect(forkSourceFolder(worktreeChat)).toEqual({
    name: "chat",
    directory: "/worktrees/alpha/chat",
    branchName: "odt/chat",
  });
});

test("suggests a worktree name only for the fork of a worktree chat", () => {
  expect(initialForkWorktree(worktreeChat)).toEqual({
    mode: "from_name",
    name: "chat-fork",
    branchName: null,
  });
  expect(initialForkWorktree(repoChat).name).toBe("");
});

test("builds the fork request of each destination", () => {
  const input = (destination: "same_folder" | "new_worktree", name = "chat-fork") =>
    workspaceSessionForkInput({
      workspaceId: "alpha",
      record: worktreeChat,
      point,
      destination,
      worktree: { mode: "from_name", name, branchName: null },
      branchPrefix: "odt",
    });
  expect(input("same_folder")).toEqual({
    workspaceId: "alpha",
    sessionId: "tree",
    forkPoint: point,
    destination: { kind: "same_folder" },
  });
  expect(input("new_worktree")?.destination).toEqual({
    kind: "new_worktree",
    name: "chat-fork",
    branchName: "odt/chat-fork",
  });
  expect(input("new_worktree", "")).toBeNull();
});
