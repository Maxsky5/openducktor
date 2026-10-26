import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { workspaceSessionRecord } from "../../test-support/workspace-session-fixtures";
import {
  sessionEntryDotTone,
  sessionEntryIconTone,
  sessionEntryLocation,
  sessionEntryTerminalContext,
  sessionEntryTitleTone,
} from "./session-entry-presentation";
import type { SessionNavigationEntry } from "./session-navigation-read-model";

const chat = workspaceSessionRecord("chat");
const task = createTaskCardFixture({ id: "task-1" });

const chatEntry = (overrides: Partial<SessionNavigationEntry> = {}): SessionNavigationEntry => ({
  key: "workspace_session:alpha:chat",
  target: { kind: "workspace_session", workspaceId: "alpha", sessionId: "chat" },
  workspace: {
    workspaceId: "alpha",
    workspaceName: "Alpha",
    repoPath: "/repos/alpha",
    abbreviation: null,
    tileColor: null,
    iconDataUrl: null,
  },
  title: "Chat",
  runtimeKind: "codex",
  workflowTone: null,
  startedAt: null,
  attention: [],
  status: { kind: "settled", failed: false },
  time: { kind: "none" },
  fault: null,
  context: { kind: "workspace", session: chat },
  ...overrides,
});

const taskSessionEntry = chatEntry({
  key: "task_session:alpha:build",
  target: {
    kind: "task_session",
    workspaceId: "alpha",
    taskId: "task-1",
    role: "build",
    identity: { externalSessionId: "build", runtimeKind: "codex", workingDirectory: "/wt/build" },
  },
  workflowTone: "done",
  context: { kind: "task", task, sessions: [] },
});

describe("session entry presentation", () => {
  test("the icon keeps the attention cue, then follows the status and the workflow", () => {
    expect(sessionEntryIconTone(chatEntry({ attention: ["question"] }))).toBe("waiting_input");
    expect(sessionEntryIconTone(chatEntry({ status: { kind: "checking" } }))).toBe("muted");
    expect(sessionEntryIconTone(taskSessionEntry)).toBe("done");
    expect(sessionEntryIconTone(chatEntry({ status: { kind: "running" } }))).toBe("in_progress");
    expect(sessionEntryIconTone(chatEntry({ status: { kind: "settled", failed: true } }))).toBe(
      "failed",
    );
    expect(sessionEntryIconTone(chatEntry())).toBe("muted");
  });

  test("the title shows attention and dims a read settled session", () => {
    expect(sessionEntryTitleTone(chatEntry({ attention: ["question"] }), false)).toBe("attention");
    expect(sessionEntryTitleTone(chatEntry(), false)).toBe("read");
    expect(sessionEntryTitleTone(chatEntry(), true)).toBe("default");
    expect(sessionEntryTitleTone(chatEntry({ status: { kind: "running" } }), false)).toBe(
      "default",
    );
  });

  test("the dot shows the input read state before running", () => {
    const asking = chatEntry({ attention: ["question"], status: { kind: "running" } });
    expect(sessionEntryDotTone(asking, true)).toBe("input_unread");
    expect(sessionEntryDotTone(asking, false)).toBe("input_read");
    expect(sessionEntryDotTone(chatEntry({ status: { kind: "running" } }), true)).toBe("running");
    expect(sessionEntryDotTone(chatEntry(), true)).toBe("unread");
    expect(sessionEntryDotTone(chatEntry(), false)).toBe("read");
  });

  test("the location and terminal context come from the chat or the task session", () => {
    expect(sessionEntryLocation(chatEntry())).toEqual({
      workingDirectory: "/repos/alpha",
      externalSessionId: "native-chat",
    });
    expect(sessionEntryLocation(taskSessionEntry)).toEqual({
      workingDirectory: "/wt/build",
      externalSessionId: "build",
    });
    expect(
      sessionEntryLocation(
        chatEntry({
          target: { kind: "task", workspaceId: "alpha", taskId: "task-1", role: null },
          context: { kind: "task", task, sessions: [] },
        }),
      ),
    ).toEqual({ workingDirectory: null, externalSessionId: null });
    expect(sessionEntryTerminalContext(chatEntry())).toEqual({
      kind: "workspace_session",
      repoPath: "/repos/alpha",
      workspaceId: "alpha",
      sessionId: "chat",
    });
    expect(sessionEntryTerminalContext(taskSessionEntry)).toEqual({
      repoPath: "/repos/alpha",
      taskId: "task-1",
    });
  });
});
