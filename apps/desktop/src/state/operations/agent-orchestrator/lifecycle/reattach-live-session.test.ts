import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createReattachLiveSession } from "./reattach-live-session";

const localHttpRuntimeResolution = {
  ok: true as const,
  runtimeKind: "opencode" as const,
  runtimeId: "runtime-1",
  runId: null,
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" } as const,
  runtimeConnection: {
    type: "local_http" as const,
    endpoint: "http://127.0.0.1:4444",
    workingDirectory: "/tmp/repo/worktree",
  },
};

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
  repoPath: "/tmp/repo",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-22T12:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
  runId: null,
  runtimeRoute: null,
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
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
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
      updateSession: (sessionId, updater) => {
        if (sessionId !== "session-1") {
          return;
        }
        state = updater(state);
      },
      attachSessionListener: () => {},
      promptOverrides: {},
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
      resumeMissingLiveSession: async () => {},
      listLiveAgentSessions: async () => [],
      isStaleRepoOperation: () => false,
      toLiveSessionState: () => "idle",
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(false);
    expect(state.pendingPermissions).toEqual(sessionStateFixture.pendingPermissions);
  });

  test("does not attach or update when the repo becomes stale after resume", async () => {
    let state = sessionStateFixture;
    let attachedSessionId: string | null = null;
    let stale = false;
    let resumeCalls = 0;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
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
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
      resumeMissingLiveSession: async () => {
        resumeCalls += 1;
        stale = true;
      },
      listLiveAgentSessions: async () => [
        {
          externalSessionId: "external-1",
          title: "Session",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-03-22T12:00:00.000Z",
          status: { type: "busy" },
          pendingPermissions: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
        },
      ],
      isStaleRepoOperation: () => stale,
      toLiveSessionState: () => "running",
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(resumeCalls).toBe(1);
    expect(reattached).toBe(false);
    expect(attachedSessionId).toBeNull();
    expect(state).toEqual(sessionStateFixture);
  });

  test("does not resume when the repo becomes stale after live lookup", async () => {
    let stale = false;
    let resumeCalls = 0;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
      updateSession: () => {
        throw new Error("should not update stale session");
      },
      attachSessionListener: () => {
        throw new Error("should not attach stale session");
      },
      promptOverrides: {},
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
      resumeMissingLiveSession: async () => {
        resumeCalls += 1;
      },
      listLiveAgentSessions: async () => {
        stale = true;
        return [
          {
            externalSessionId: "external-1",
            title: "Session",
            role: "build",
            scenario: "build_implementation_start",
            startedAt: "2026-03-22T12:00:00.000Z",
            status: { type: "busy" },
            pendingPermissions: [],
            pendingQuestions: [],
            workingDirectory: "/tmp/repo/worktree",
          },
        ];
      },
      isStaleRepoOperation: () => stale,
      toLiveSessionState: () => "running",
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(false);
    expect(resumeCalls).toBe(0);
  });

  test("skips live reattachment for unsupported stdio OpenCode runtimes", async () => {
    let liveLookupCalls = 0;
    let resumeCalls = 0;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
      updateSession: () => {
        throw new Error("should not update unsupported session");
      },
      attachSessionListener: () => {
        throw new Error("should not attach unsupported session");
      },
      promptOverrides: {},
      resolveHydrationRuntime: async () => ({
        ok: true,
        runtimeKind: "opencode",
        runtimeId: "runtime-stdio",
        runId: null,
        runtimeRoute: { type: "stdio" },
        runtimeConnection: {
          type: "stdio",
          workingDirectory: "/tmp/repo/worktree",
        },
      }),
      resumeMissingLiveSession: async () => {
        resumeCalls += 1;
      },
      listLiveAgentSessions: async () => {
        liveLookupCalls += 1;
        return [];
      },
      isStaleRepoOperation: () => false,
      toLiveSessionState: () => "idle",
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(false);
    expect(liveLookupCalls).toBe(0);
    expect(resumeCalls).toBe(0);
  });
});
