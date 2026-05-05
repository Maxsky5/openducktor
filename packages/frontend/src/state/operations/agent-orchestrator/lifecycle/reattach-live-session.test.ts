import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import { toLiveSessionTruthFromSnapshot } from "@openducktor/core";
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
  runtimeKind: "opencode",
  workingDirectory: "/tmp/repo/worktree",
  startedAt: "2026-03-22T12:00:00.000Z",
  selectedModel: null,
};

const toLiveTruth = (
  snapshot: Parameters<typeof toLiveSessionTruthFromSnapshot>[0]["snapshot"],
  runtimeResolution: Extract<ResolvedHydrationRuntime, { ok: true }> = localHttpRuntimeResolution,
) =>
  toLiveSessionTruthFromSnapshot({
    ref: {
      repoPath: "/tmp/repo",
      runtimeKind: runtimeResolution.runtimeKind,
      externalSessionId: sessionRecordFixture.externalSessionId,
      workingDirectory: runtimeResolution.workingDirectory,
    },
    runtimeId: runtimeResolution.runtimeId,
    snapshot,
  });

const createSessionStateFixture = (): AgentSessionState => ({
  externalSessionId: "external-1",
  taskId: "task-1",
  repoPath: "/tmp/repo",
  role: "build",
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
  pendingApprovals: [
    {
      requestId: "permission-1",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: [".env"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    },
  ],
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
      attachMissingLiveSession: async () => {
        resumed = true;
      },
      readLiveSessionTruth: async () =>
        toLiveTruth({
          externalSessionId: "external-1",
          title: "Session",
          startedAt: "2026-03-22T12:00:00.000Z",
          status: { type: "idle" },
          pendingApprovals: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
        }),
      isStaleRepoOperation: () => false,
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(false);
    expect(resumed).toBe(false);
    expect(attachedSessionId).toBeNull();
    expect(state.pendingApprovals).toEqual(createSessionStateFixture().pendingApprovals);
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
      attachMissingLiveSession: async () => {
        resumed = true;
      },
      readLiveSessionTruth: async () =>
        toLiveTruth({
          externalSessionId: "external-1",
          title: "Session",
          startedAt: "2026-03-22T12:00:00.000Z",
          status: { type: "idle" },
          pendingApprovals: [
            {
              requestId: "permission-2",
              requestType: "permission_grant" as const,
              title: `Approve permission: ${"read"}`,
              summary: `Approval request for ${"read"}.`,
              affectedPaths: [],
              action: { name: "read" },
              mutation: "read_only" as const,
              supportedReplyOutcomes: [
                "approve_once" as const,
                "approve_session" as const,
                "reject" as const,
              ],
            },
          ],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
        }),
      isStaleRepoOperation: () => false,
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(true);
    expect(resumed).toBe(true);
    expect(attachedSessionId === "external-1").toBe(true);
    expect(state.pendingApprovals).toEqual([
      {
        requestId: "permission-2",
        requestType: "permission_grant" as const,
        title: `Approve permission: ${"read"}`,
        summary: `Approval request for ${"read"}.`,
        affectedPaths: [],
        action: { name: "read" },
        mutation: "read_only" as const,
        supportedReplyOutcomes: [
          "approve_once" as const,
          "approve_session" as const,
          "reject" as const,
        ],
      },
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
      attachMissingLiveSession: async () => {
        resumed = true;
      },
      allowAttachMissingSession: false,
      readLiveSessionTruth: async () =>
        toLiveTruth({
          externalSessionId: "external-1",
          title: "Session",
          startedAt: "2026-03-22T12:00:00.000Z",
          status: { type: "busy" },
          pendingApprovals: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
        }),
      isStaleRepoOperation: () => false,
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
      attachMissingLiveSession: async () => {},
      readLiveSessionTruth: async () => toLiveTruth(null),
      isStaleRepoOperation: () => false,
    });

    const reattached = await reattachLiveSession(sessionRecordFixture);

    expect(reattached).toBe(false);
    expect(state.pendingApprovals).toEqual(createSessionStateFixture().pendingApprovals);
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
      attachMissingLiveSession: async () => {
        resumeCalls += 1;
        stale = true;
      },
      readLiveSessionTruth: async () =>
        toLiveTruth({
          externalSessionId: "external-1",
          title: "Session",
          startedAt: "2026-03-22T12:00:00.000Z",
          status: { type: "busy" },
          pendingApprovals: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
        }),
      isStaleRepoOperation: () => stale,
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
      attachMissingLiveSession: async () => {
        resumeCalls += 1;
      },
      readLiveSessionTruth: async () => {
        stale = true;
        return toLiveTruth({
          externalSessionId: "external-1",
          title: "Session",
          startedAt: "2026-03-22T12:00:00.000Z",
          status: { type: "busy" },
          pendingApprovals: [],
          pendingQuestions: [],
          workingDirectory: "/tmp/repo/worktree",
        });
      },
      isStaleRepoOperation: () => stale,
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
      attachMissingLiveSession: async () => {
        resumeCalls += 1;
      },
      readLiveSessionTruth: async () => {
        liveLookupCalls += 1;
        return toLiveTruth(null, stdioRuntimeResolution);
      },
      isStaleRepoOperation: () => false,
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
      attachMissingLiveSession: async () => {},
      readLiveSessionTruth: async () => {
        throw new Error("live lookup failed");
      },
      isStaleRepoOperation: () => false,
    });

    await expect(reattachLiveSession(sessionRecordFixture)).rejects.toThrow("live lookup failed");
  });
});
