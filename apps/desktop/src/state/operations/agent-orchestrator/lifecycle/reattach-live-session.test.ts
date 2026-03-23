import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createReattachLiveSession } from "./reattach-live-session";

const sessionRecordFixture: AgentSessionRecord = {
  sessionId: "session-1",
  externalSessionId: "external-1",
  role: "build",
  scenario: "build_implementation_start",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

const sessionStateFixture: AgentSessionState = {
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-22T12:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "",
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: [".env"] }],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
  promptOverrides: {},
};

describe("reattach-live-session", () => {
  test("clears pending input when the live snapshot is empty", async () => {
    let state = sessionStateFixture;
    let resumed = false;
    let attachedSessionId: string | null = null;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
      taskId: "task-1",
      taskRef: { current: [] },
      sessionsRef: { current: { "session-1": sessionStateFixture } },
      updateSession: (sessionId, updater) => {
        if (sessionId !== "session-1") {
          return;
        }
        state = updater(state);
      },
      attachSessionListener: (_repoPath, sessionId) => {
        attachedSessionId = sessionId;
      },
      promptOverrides: {},
      resolveHydrationRuntime: async () => ({
        ok: true,
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        },
      }),
      resumeMissingLiveSession: async () => {
        resumed = true;
      },
      listLiveAgentSessions: async () => [
        {
          externalSessionId: "external-1",
          title: "Session",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-03-22T12:00:00.000Z",
          status: { type: "idle" },
          pendingPermissions: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
        },
      ],
      isStaleRepoOperation: () => false,
      toLiveSessionState: () => "idle",
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(true);
    expect(resumed).toBe(true);
    expect(attachedSessionId === "session-1").toBe(true);
    expect(state.pendingPermissions).toEqual([]);
  });

  test("returns false when no live snapshot matches the persisted session", async () => {
    let state = sessionStateFixture;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => true,
      },
      repoPath: "/tmp/repo",
      taskId: "task-1",
      taskRef: { current: [] },
      sessionsRef: { current: { "session-1": sessionStateFixture } },
      updateSession: (sessionId, updater) => {
        if (sessionId !== "session-1") {
          return;
        }
        state = updater(state);
      },
      attachSessionListener: () => {},
      promptOverrides: {},
      resolveHydrationRuntime: async () => ({
        ok: true,
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        runId: null,
        runtimeEndpoint: "http://127.0.0.1:4444",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        },
      }),
      resumeMissingLiveSession: async () => {},
      listLiveAgentSessions: async () => [],
      isStaleRepoOperation: () => false,
      toLiveSessionState: () => "idle",
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(false);
    expect(state.pendingPermissions).toEqual(sessionStateFixture.pendingPermissions);
  });
});
