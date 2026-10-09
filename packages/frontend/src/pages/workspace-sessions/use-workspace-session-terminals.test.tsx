import { expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { renderHook } from "@testing-library/react";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import { useWorkspaceSessionTerminals } from "./use-workspace-session-terminals";

const workspace = { workspaceId: "workspace-1", workspaceName: "Repo", repoPath: "/repo" };

const chat = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: "chat-1",
  runtimeKind: "opencode",
  externalSessionId: "native-chat-1",
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: "/repo/.worktrees/chat-1",
    branchName: "chat-1",
    worktreeState: "present",
  },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: "Chat",
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
  ...overrides,
});

const startBlockedReason = (selected: WorkspaceSession): string | null => {
  const view = renderHook(
    () => useWorkspaceSessionTerminals({ workspace, selected, sessions: [selected] }),
    { wrapper: IsolatedQueryWrapper },
  );
  try {
    return view.result.current.startBlockedReason;
  } finally {
    view.unmount();
  }
};

test("a chat with a present worktree waits only for terminal discovery", () => {
  expect(startBlockedReason(chat())).toBe("Terminals are loading.");
});

test("an archived chat or a removed chat worktree gives the reason that terminals cannot start", () => {
  expect(startBlockedReason(chat({ archivedAt: 2000 }))).toBe(
    "This chat is archived. Restore the chat to use terminals.",
  );
  expect(
    startBlockedReason(
      chat({
        executionTarget: {
          kind: "local_worktree",
          workingDirectory: "/repo/.worktrees/chat-1",
          branchName: "chat-1",
          worktreeState: "removed",
        },
      }),
    ),
  ).toBe("The worktree of this chat was removed. Restore the chat to create the worktree again.");
});
