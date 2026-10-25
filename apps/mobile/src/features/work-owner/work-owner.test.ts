import { describe, expect, test } from "bun:test";
import type {
  AgentSessionRecord,
  TaskCard,
  WorkspaceRecord,
  WorkspaceSession,
} from "@openducktor/contracts";
import {
  chatFeedbackTarget,
  findChatRecord,
  type OwnerRead,
  pickFeedbackBuilder,
  resolveChatOwner,
  resolveTaskOwner,
  taskFeedbackTarget,
} from "./work-owner-model";
import {
  readWorkOwnerRef,
  toWorkOwnerParams,
  type WorkOwnerRef,
  workOwnerRefKey,
} from "./work-owner-params";

const workspace: WorkspaceRecord = {
  workspaceId: "ws-1",
  workspaceName: "Repo",
  abbreviation: null,
  tileColor: null,
  repoPath: "/repos/repo",
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
};

// SAFETY: The resolution reads only the ID and title of a task.
const task = { id: "task-1", title: "Fix the parser" } as TaskCard;

const record: WorkspaceSession = {
  id: "chat-1",
  runtimeKind: "opencode",
  externalSessionId: "ext-1",
  executionTarget: {
    kind: "local_worktree",
    workingDirectory: "/repos/repo/.worktrees/chat",
    branchName: "chat",
    worktreeState: "present",
  },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: "Parser chat",
  manualTitle: null,
  targetBranch: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};

const ready = <Data>(data: Data): OwnerRead<Data> => ({ data, error: null, isPending: false });
const loading = <Data>(): OwnerRead<Data> => ({ data: undefined, error: null, isPending: true });
const failed = <Data>(message: string): OwnerRead<Data> => ({
  data: undefined,
  error: new Error(message),
  isPending: false,
});

const session = (
  externalSessionId: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId,
  role: "build",
  startedAt: "2026-10-01T10:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/repos/repo/.worktrees/task-1",
  selectedModel: null,
  ...overrides,
});

describe("work owner params", () => {
  test("reads a task owner and a chat owner from route params", () => {
    expect(readWorkOwnerRef({ workspaceId: "ws-1", taskId: "task-1" })).toEqual({
      kind: "task",
      workspaceId: "ws-1",
      taskId: "task-1",
    });
    const chat = readWorkOwnerRef({
      workspaceId: "ws-1",
      externalSessionId: "ext-1",
      runtimeKind: "opencode",
      workingDirectory: "/repos/repo",
    });
    expect(chat?.kind).toBe("chat");
    if (chat)
      expect(toWorkOwnerParams(chat)).toEqual({
        workspaceId: "ws-1",
        externalSessionId: "ext-1",
        runtimeKind: "opencode",
        workingDirectory: "/repos/repo",
      });
  });

  test("rejects params that name neither a task nor a full chat identity", () => {
    expect(readWorkOwnerRef({ taskId: "task-1" })).toBeNull();
    expect(readWorkOwnerRef({ workspaceId: "ws-1", externalSessionId: "ext-1" })).toBeNull();
    expect(
      readWorkOwnerRef({
        workspaceId: "ws-1",
        externalSessionId: "ext-1",
        runtimeKind: "unknown-runtime",
        workingDirectory: "/repos/repo",
      }),
    ).toBeNull();
    expect(readWorkOwnerRef({ workspaceId: " ", taskId: "task-1" })).toBeNull();
    expect(readWorkOwnerRef({ workspaceId: ["ws-1", "ws-2"], taskId: ["task-1"] })?.kind).toBe(
      "task",
    );
  });

  test("gives each owner its own key", () => {
    const first = workOwnerRefKey({ kind: "task", workspaceId: "ws-1", taskId: "task-1" });
    const second = workOwnerRefKey({ kind: "task", workspaceId: "ws-2", taskId: "task-1" });
    expect(first).not.toBe(second);
  });
});

describe("task owner resolution", () => {
  const ref = { kind: "task" as const, workspaceId: "ws-1", taskId: "task-1" };

  test("waits for the workspaces, then the tasks", () => {
    expect(resolveTaskOwner(ref, loading(), loading()).status).toBe("loading");
    expect(resolveTaskOwner(ref, ready([workspace]), loading())).toEqual({
      status: "loading",
      label: "Loading the task",
    });
  });

  test("resolves the workspace, the task, and its comment owner", () => {
    expect(resolveTaskOwner(ref, ready([workspace]), ready([task]))).toEqual({
      status: "ready",
      owner: {
        kind: "task",
        workspace,
        task,
        commentOwner: { kind: "task", workspaceId: "ws-1", taskId: "task-1" },
      },
    });
  });

  test("tells why the owner cannot resolve", () => {
    expect(resolveTaskOwner(ref, ready([]), ready([task]))).toMatchObject({
      status: "error",
      title: "Workspace Not Open",
    });
    expect(resolveTaskOwner(ref, ready([workspace]), ready([]))).toMatchObject({
      status: "error",
      title: "Task Not Found",
    });
    expect(resolveTaskOwner(ref, failed("Host offline."), loading())).toMatchObject({
      status: "error",
      message: "Host offline.",
      canRetry: true,
    });
  });
});

describe("chat owner resolution", () => {
  const ref: Extract<WorkOwnerRef, { kind: "chat" }> = {
    kind: "chat",
    workspaceId: "ws-1",
    externalSessionId: "ext-1",
    runtimeKind: "opencode",
    workingDirectory: "/repos/repo/.worktrees/chat",
  };

  test("finds the saved chat of the runtime session in its working directory", () => {
    expect(findChatRecord([record], ref)).toBe(record);
    expect(findChatRecord([record], { ...ref, workingDirectory: `${ref.workingDirectory}/` })).toBe(
      record,
    );
    expect(findChatRecord([record], { ...ref, runtimeKind: "codex" })).toBeNull();
    expect(findChatRecord([record], { ...ref, workingDirectory: "/repos/repo" })).toBeNull();
    expect(findChatRecord(undefined, ref)).toBeNull();
  });

  test("resolves the chat comment owner from the saved chat ID", () => {
    const resolution = resolveChatOwner(ref, ready([workspace]), ready([record]));
    expect(resolution.status === "ready" ? resolution.owner.commentOwner : null).toEqual({
      kind: "workspace_session",
      workspaceId: "ws-1",
      sessionId: "chat-1",
    });
    expect(resolveChatOwner(ref, ready([workspace]), ready([]))).toMatchObject({
      status: "error",
      title: "Chat Not Found",
    });
  });

  test("sends chat feedback to the chat session itself", () => {
    expect(chatFeedbackTarget(ref)).toEqual({
      session: {
        workspaceId: "ws-1",
        externalSessionId: "ext-1",
        runtimeKind: "opencode",
        workingDirectory: "/repos/repo/.worktrees/chat",
      },
      blockedReason: null,
      retry: null,
    });
  });
});

describe("task feedback target", () => {
  const worktree = "/repos/repo/.worktrees/task-1";

  test("picks the latest Builder in the task worktree", () => {
    const sessions = [
      session("old", { lastActivityAt: 10 }),
      session("new", { lastActivityAt: 30 }),
      session("elsewhere", { lastActivityAt: 50, workingDirectory: "/repos/repo" }),
      session("planner", { lastActivityAt: 90, role: "planner" }),
    ];
    expect(pickFeedbackBuilder(sessions, `${worktree}/`)?.externalSessionId).toBe("new");
  });

  test("uses the latest Builder when no Builder runs in the worktree", () => {
    const sessions = [
      session("first", { startedAt: "2026-10-01T10:00:00.000Z", workingDirectory: "/a" }),
      session("second", { startedAt: "2026-10-02T10:00:00.000Z", workingDirectory: "/b" }),
    ];
    expect(pickFeedbackBuilder(sessions, worktree)?.externalSessionId).toBe("second");
    expect(pickFeedbackBuilder(sessions, null)?.externalSessionId).toBe("second");
  });

  test("opens the Builder session or tells why it cannot", () => {
    const retry = () => {};
    expect(taskFeedbackTarget("ws-1", ready([session("b1")]), worktree, retry)).toEqual({
      session: {
        workspaceId: "ws-1",
        externalSessionId: "b1",
        runtimeKind: "opencode",
        workingDirectory: worktree,
      },
      blockedReason: null,
      retry: null,
    });
    expect(taskFeedbackTarget("ws-1", ready([]), worktree, retry)).toEqual({
      session: null,
      blockedReason: "Start the Builder for this task, then send the feedback.",
      retry: null,
    });
    expect(taskFeedbackTarget("ws-1", loading(), worktree, retry)).toEqual({
      session: null,
      blockedReason: "Loading the task sessions.",
      retry: null,
    });
  });

  test("offers a retry after the session list read fails", () => {
    const retry = () => {};
    expect(taskFeedbackTarget("ws-1", failed("Read failed."), worktree, retry)).toEqual({
      session: null,
      blockedReason: "Could not load the task sessions: Read failed.",
      retry,
    });
  });
});
