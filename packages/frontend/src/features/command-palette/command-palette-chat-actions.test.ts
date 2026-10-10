import { describe, expect, mock, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import { createWorkspaceRecordFixture } from "@/test-utils/shared-test-fixtures";
import { paletteChatActions } from "./command-palette-chat-actions";
import type { PaletteChat } from "./command-palette-types";

const chatWith = (externalSessionId: string | null): PaletteChat => {
  const session: WorkspaceSession = {
    id: "c-1",
    runtimeKind: "codex",
    externalSessionId,
    executionTarget: {
      kind: "local_worktree",
      workingDirectory: "/repo/worktrees/c-1",
      branchName: "c-1",
      worktreeState: "present",
    },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: "Release notes",
    manualTitle: null,
    createdAt: 0,
    lastActivityAt: 0,
    updatedAt: 0,
    archivedAt: null,
  };
  return { key: "chat:w:c-1", workspace: createWorkspaceRecordFixture(), session, title: "x" };
};

const handlers = () => ({
  open: mock(() => {}),
  setUnread: mock((_unread: boolean) => {}),
  rename: mock(() => {}),
  archive: mock(() => {}),
  copy: mock((_value: string) => {}),
});

describe("paletteChatActions", () => {
  test("lists Open chat, then the sidebar menu actions with Archive chat last", () => {
    const actions = paletteChatActions(chatWith("native-1"), false, handlers());

    expect(actions.map((action) => action.label)).toEqual([
      "Open chat",
      "Mark as unread",
      "Rename chat",
      "Copy working directory",
      "Copy external session ID",
      "Archive chat",
    ]);
    expect(actions.filter((action) => action.destructive).map((action) => action.key)).toEqual([
      "archive",
    ]);
  });

  test("marks an unread chat as read and a read chat as unread", () => {
    const unreadHandlers = handlers();
    const readHandlers = handlers();

    const markRead = paletteChatActions(chatWith(null), true, unreadHandlers)[1];
    const markUnread = paletteChatActions(chatWith(null), false, readHandlers)[1];
    markRead?.run();
    markUnread?.run();

    expect(markRead?.label).toBe("Mark as read");
    expect(unreadHandlers.setUnread).toHaveBeenCalledWith(false);
    expect(readHandlers.setUnread).toHaveBeenCalledWith(true);
  });

  test("copies the working directory and the external session ID of the chat", () => {
    const chatHandlers = handlers();
    const actions = paletteChatActions(chatWith("native-1"), false, chatHandlers);

    for (const action of actions.filter((entry) => entry.key.startsWith("copy-"))) action.run();

    expect(chatHandlers.copy.mock.calls).toEqual([["/repo/worktrees/c-1"], ["native-1"]]);
  });

  test("disables the copy of an external session ID that the chat does not have yet", () => {
    const actions = paletteChatActions(chatWith(null), false, handlers());

    expect(actions.find((action) => action.key === "copy-external-session-id")?.disabled).toBe(
      true,
    );
  });
});
