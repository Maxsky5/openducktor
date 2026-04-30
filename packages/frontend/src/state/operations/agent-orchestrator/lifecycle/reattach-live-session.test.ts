import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ResolvedHydrationRuntime } from "./hydration-runtime-resolution";
import { createReattachLiveSession } from "./reattach-live-session";

const localHttpRuntimeResolution: ResolvedHydrationRuntime = {
  ok: true,
  runtimeKind: "opencode",
  runtimeId: "runtime-1",
  workingDirectory: "/tmp/repo/worktree",
};

const stdioRuntimeResolution: ResolvedHydrationRuntime = {
  ok: true,
  runtimeKind: "opencode",
  runtimeId: "runtime-stdio",
  workingDirectory: "/tmp/repo/worktree",
};

const sessionRecordFixture: AgentSessionRecord = {
  externalSessionId: "external-1",
  role: "build",
  scenario: "build_implementation_start",
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

const createSessionStateFixture = (): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: "/tmp/repo",
  role: "build",
  scenario: "build_implementation_start",
  status: "idle",
  startedAt: "2026-03-22T12:00:00.000Z",
  runtimeKind: "opencode",
  runtimeId: null,
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
});

describe("reattach-live-session", () => {
  test("does not resume an idle snapshot with no pending input", async () => {
    let state = createSessionStateFixture();
    let resumed = false;
    let attachedSessionId: string | null = null;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
      updateSession: (externalSessionId, updater) => {
        if (externalSessionId !== "external-1") {
          return;
        }
        state = updater(state);
      },
      attachSessionListener: (_repoPath, externalSessionId) => {
        attachedSessionId = externalSessionId;
      },
      promptOverrides: {},
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
      attachMissingLiveSession: async () => {
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

    expect(reattached).toBe(false);
    expect(resumed).toBe(false);
    expect(attachedSessionId).toBeNull();
    expect(state.pendingPermissions).toEqual(createSessionStateFixture().pendingPermissions);
  });

  test("reattaches an idle snapshot when pending input is still live", async () => {
    let state = createSessionStateFixture();
    let resumed = false;
    let attachedSessionId: string | null = null;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
      updateSession: (externalSessionId, updater) => {
        if (externalSessionId !== "external-1") {
          return;
        }
        state = updater(state);
      },
      attachSessionListener: (_repoPath, externalSessionId) => {
        attachedSessionId = externalSessionId;
      },
      promptOverrides: {},
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
      attachMissingLiveSession: async () => {
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
          pendingPermissions: [{ requestId: "permission-2", permission: "read", patterns: [] }],
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
    expect(attachedSessionId === "external-1").toBe(true);
    expect(state.pendingPermissions).toEqual([
      { requestId: "permission-2", permission: "read", patterns: [] },
    ]);
  });

  test("does not resume a missing live session when resume is explicitly disabled", async () => {
    let state = createSessionStateFixture();
    let resumed = false;
    let attachedSessionId: string | null = null;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
      updateSession: (externalSessionId, updater) => {
        if (externalSessionId !== "external-1") {
          return;
        }
        state = updater(state);
      },
      attachSessionListener: (_repoPath, externalSessionId) => {
        attachedSessionId = externalSessionId;
      },
      promptOverrides: {},
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
      attachMissingLiveSession: async () => {
        resumed = true;
      },
      allowAttachMissingSession: false,
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
      isStaleRepoOperation: () => false,
      toLiveSessionState: () => "running",
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(false);
    expect(resumed).toBe(false);
    expect(attachedSessionId).toBeNull();
    expect(state).toEqual(createSessionStateFixture());
  });

  test("returns false when no live snapshot matches the persisted session", async () => {
    let state = createSessionStateFixture();

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => true,
      },
      repoPath: "/tmp/repo",
      updateSession: (externalSessionId, updater) => {
        if (externalSessionId !== "external-1") {
          return;
        }
        state = updater(state);
      },
      attachSessionListener: () => {},
      promptOverrides: {},
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
      attachMissingLiveSession: async () => {},
      listLiveAgentSessions: async () => [],
      isStaleRepoOperation: () => false,
      toLiveSessionState: () => "idle",
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(false);
    expect(state.pendingPermissions).toEqual(createSessionStateFixture().pendingPermissions);
  });

  test("does not attach or update when the repo becomes stale after resume", async () => {
    let state = createSessionStateFixture();
    let attachedSessionId: string | null = null;
    let stale = false;
    let resumeCalls = 0;

    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
      updateSession: (externalSessionId, updater) => {
        if (externalSessionId !== "external-1") {
          return;
        }
        state = updater(state);
      },
      attachSessionListener: (_repoPath, externalSessionId) => {
        attachedSessionId = externalSessionId;
      },
      promptOverrides: {},
      resolveHydrationRuntime: async () => localHttpRuntimeResolution,
      attachMissingLiveSession: async () => {
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
    expect(state).toEqual(createSessionStateFixture());
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
      attachMissingLiveSession: async () => {
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

  test("attempts live discovery for stdio OpenCode runtimes", async () => {
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
      resolveHydrationRuntime: async () => stdioRuntimeResolution,
      attachMissingLiveSession: async () => {
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
    expect(liveLookupCalls).toBe(1);
    expect(resumeCalls).toBe(0);
  });

  test("propagates live lookup failures for stdio OpenCode runtimes", async () => {
    const reattachLiveSession = createReattachLiveSession({
      adapter: {
        hasSession: () => false,
      },
      repoPath: "/tmp/repo",
      updateSession: () => {
        throw new Error("should not update failed session");
      },
      attachSessionListener: () => {
        throw new Error("should not attach failed session");
      },
      promptOverrides: {},
      resolveHydrationRuntime: async () => stdioRuntimeResolution,
      attachMissingLiveSession: async () => {},
      listLiveAgentSessions: async () => {
        throw new Error("live lookup failed");
      },
      isStaleRepoOperation: () => false,
      toLiveSessionState: () => "idle",
    });

    await expect(reattachLiveSession(sessionRecordFixture)).rejects.toThrow("live lookup failed");
  });
});
