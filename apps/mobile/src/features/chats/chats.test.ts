import { describe, expect, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionArchivePreview } from "@openducktor/contracts";
import { archiveChatForm, archiveChatInput } from "./archive-chat-form";
import {
  type ArchivedChatItem,
  archivedChatItems,
  chatDaySection,
  startOfLocalDay,
} from "./chat-sections";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const minutesAgo = (minutes: number): number => NOW - minutes * 60_000;

const workspace = {
  workspaceId: "alpha",
  workspaceName: "Alpha",
  repoPath: "/repos/alpha",
  abbreviation: null,
  tileColor: null,
  iconDataUrl: null,
};

const chat = (id: string, overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id,
  runtimeKind: "codex",
  externalSessionId: `native-${id}`,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repos/alpha" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: `Chat ${id}`,
  manualTitle: null,
  createdAt: minutesAgo(600),
  updatedAt: minutesAgo(600),
  archivedAt: null,
  targetBranch: null,
  ...overrides,
});

const worktreeChat = chat("tree", {
  manualTitle: "Login worktree",
  roleSnapshot: { id: "role", name: "Reviewer", systemPrompt: "Review." },
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: "/worktrees/alpha/login",
    branchName: "odt/login",
    worktreeState: "present",
  },
  lastActivityAt: minutesAgo(30),
});

describe("chat sections", () => {
  // Local noon, so the day sections do not depend on the time zone of the test run.
  const NOON = new Date(2026, 9, 19, 12, 0).getTime();
  const hoursAgo = (hours: number): number => NOON - hours * 3_600_000;
  const describeItems = (items: ArchivedChatItem[]): string[] =>
    items.map((item) =>
      item.type === "header" ? `${item.sectionId} (${item.count})` : item.record.id,
    );

  test("name the local calendar day of a time", () => {
    const today = startOfLocalDay(NOON);
    const yesterday = new Date(2026, 9, 18).getTime();
    expect(today).toBe(new Date(2026, 9, 19).getTime());
    expect(chatDaySection(today, NOON)).toBe("today");
    expect(chatDaySection(NOON + 60_000, NOON)).toBe("today");
    expect(chatDaySection(today - 1, NOON)).toBe("yesterday");
    expect(chatDaySection(yesterday, NOON)).toBe("yesterday");
    expect(chatDaySection(yesterday - 1, NOON)).toBe("earlier");
    expect(chatDaySection(null, NOON)).toBe("earlier");
    // The start of the day gives the same sections as any time of that day.
    expect(chatDaySection(today - 1, today)).toBe("yesterday");
  });

  test("put archived chats in the day of their archive, latest first", () => {
    const records = [
      chat("week", { archivedAt: hoursAgo(24 * 7) }),
      chat("never"),
      chat("hour", { archivedAt: hoursAgo(1) }),
      chat("night", { archivedAt: hoursAgo(13) }),
      chat("noon", { archivedAt: hoursAgo(0) }),
    ];
    expect(describeItems(archivedChatItems(records, NOON))).toEqual([
      "today (2)",
      "noon",
      "hour",
      "yesterday (1)",
      "night",
      "earlier (2)",
      "week",
      "never",
    ]);
  });
});

describe("archive consent", () => {
  const preview = (overrides: Partial<WorkspaceSessionArchivePreview> = {}) => ({
    data: {
      branchName: "odt/login",
      worktreeExists: true,
      hasUncommittedChanges: false,
      sharedWith: [],
      taskOwners: [],
      ...overrides,
    },
    isSuccess: true,
    isFetching: false,
  });
  const loading = { data: undefined, isSuccess: false, isFetching: true };

  test("a repository chat archives at once and keeps its files", () => {
    const record = chat("plain");
    expect(
      archiveChatForm({ record, wantsWorktreeRemoval: true, preview: loading, isArchiving: false }),
    ).toEqual({
      offersWorktreeRemoval: false,
      removeWorktree: true,
      sharedNotice: null,
      taskNotice: null,
      canArchive: true,
      destructive: false,
      notice: { kind: "keep", text: "Your repository files will stay on disk." },
      warnings: [],
    });
    expect(
      archiveChatInput({ workspace, record, wantsWorktreeRemoval: true, preview: loading }),
    ).toEqual({
      workspaceId: "alpha",
      repoPath: "/repos/alpha",
      sessionId: "plain",
      confirmStop: true,
      removeWorktree: false,
      worktreeConfirmation: undefined,
    });
  });

  test("a worktree chat removes its worktree only after the preview names the branch", () => {
    const form = (removeWorktree: boolean, read: ReturnType<typeof preview> | typeof loading) =>
      archiveChatForm({
        record: worktreeChat,
        wantsWorktreeRemoval: removeWorktree,
        preview: read,
        isArchiving: false,
      });
    // The sheet shows its loader while the worktree check runs, so nothing archives or deletes.
    expect(form(true, loading)).toMatchObject({ canArchive: false, destructive: false });
    expect(form(true, preview({ hasUncommittedChanges: true }))).toMatchObject({
      canArchive: true,
      notice: { kind: "delete_branch", branchName: "odt/login" },
      warnings: [{ kind: "local_changes" }],
    });
    expect(form(true, preview({ branchName: null }))).toMatchObject({
      canArchive: false,
      notice: { kind: "no_branch" },
    });
    expect(form(false, loading)).toMatchObject({ canArchive: false, destructive: false });
    expect(form(false, preview())).toMatchObject({
      canArchive: true,
      destructive: false,
      notice: { kind: "keep" },
    });
    expect(
      archiveChatInput({
        workspace,
        record: worktreeChat,
        wantsWorktreeRemoval: true,
        preview: preview(),
      }),
    ).toEqual({
      workspaceId: "alpha",
      repoPath: "/repos/alpha",
      sessionId: "tree",
      confirmStop: true,
      removeWorktree: true,
      worktreeConfirmation: { workingDirectory: "/worktrees/alpha/login", branchName: "odt/login" },
    });
  });

  test("a worktree that other saved chats need stays, and the form names them", () => {
    const shared = preview({
      sharedWith: [{ workspaceId: "alpha", sessionId: "docs", title: "Docs" }],
    });
    expect(
      archiveChatForm({
        record: worktreeChat,
        wantsWorktreeRemoval: true,
        preview: shared,
        isArchiving: false,
      }),
    ).toMatchObject({
      removeWorktree: false,
      destructive: false,
      sharedNotice:
        "This worktree stays because these saved chats need it for files or history: Docs.",
      notice: { kind: "keep" },
    });
    expect(
      archiveChatInput({
        workspace,
        record: worktreeChat,
        wantsWorktreeRemoval: true,
        preview: shared,
      }),
    ).toMatchObject({ removeWorktree: false, worktreeConfirmation: undefined });
  });

  test("a chat that is archiving cannot archive again", () => {
    expect(
      archiveChatForm({
        record: chat("plain"),
        wantsWorktreeRemoval: false,
        preview: loading,
        isArchiving: true,
      }).canArchive,
    ).toBe(false);
  });
});
