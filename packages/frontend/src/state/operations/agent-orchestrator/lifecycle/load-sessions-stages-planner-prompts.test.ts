import { describe, expect, test } from "bun:test";
import {
  type AttachSessionInput,
  agentSessionPresenceLookupKey,
  createHydrationPromptAssemblerStage,
  createIntent,
  createLifecycleAdapter,
  createRecord,
  createRuntime,
  createRuntimeResolutionPlannerStage,
  createSession,
  createSessionPresenceSnapshot,
  createStalePresence,
  createStateHarness,
  createStdioRuntime,
  createTaskFixture,
  getSessionMessageCount,
  type ListSessionPresenceInput,
  type ResumeSessionInput,
  type RuntimeInstanceSummary,
  type RuntimeKind,
  reconcileLiveSessionsStage,
  sessionMessageAt,
} from "./load-sessions-stages-test-harness";

describe("load-sessions-stages", () => {
  test("runtime planner ignores stale hydrated runtime state and reuses preloaded live snapshots", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const liveSnapshot = createSessionPresenceSnapshot("external-1", workingDirectory, {
      title: "Builder Session",
      startedAt: "2026-03-01T09:00:00.000Z",
      status: { type: "busy" },
      pendingApprovals: [],
      pendingQuestions: [],
    });
    let snapshotLoads = 0;
    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "requested_history",
        requestedSessionId: "external-1",
        requestedHistoryKey: "/tmp/repo::task-1::external-1",
        shouldHydrateRequestedSession: true,
        historyPolicy: "requested_only",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime(workingDirectory)]],
        ]),
        preloadedSessionPresenceByKey: new Map([
          [
            agentSessionPresenceLookupKey("/tmp/repo", "opencode", workingDirectory),
            [
              createSessionPresenceSnapshot("external-1", workingDirectory, {
                title: "Builder Session",
                startedAt: "2026-03-01T09:00:00.000Z",
                status: { type: "busy" },
                pendingApprovals: [],
                pendingQuestions: [],
              }),
            ],
          ],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listSessionPresence: async () => {
          snapshotLoads += 1;
          return [];
        },
      },
      recordsToHydrate: [createRecord({ role: "planner", workingDirectory })],
    });

    const snapshot = await planner.readSessionPresence(
      createRecord({ role: "planner", workingDirectory }),
    );

    expect(snapshot).toEqual(liveSnapshot);
    expect(snapshotLoads).toBe(0);
  });

  test("runtime planner hydrates inactive worktree sessions through the repo runtime", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const snapshotRequests: Array<{ directories?: string[] }> = [];

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "recover_runtime_attachment",
        requestedSessionId: "external-1",
        shouldReconcileLiveSessions: true,
        historyPolicy: "none",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime("/tmp/repo")]],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listSessionPresence: async (input: ListSessionPresenceInput) => {
          snapshotRequests.push(input.directories ? { directories: input.directories } : {});
          return [];
        },
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const resolution = await planner.resolveHydrationRuntime(createRecord({ workingDirectory }));

    expect(snapshotRequests).toEqual([]);
    expect(resolution).toEqual({
      ok: true,
      runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
      workingDirectory,
    });
  });

  test("runtime planner reuses cached live snapshots without re-scanning", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const preloadedSessionPresenceByKey = new Map([
      [agentSessionPresenceLookupKey("/tmp/repo", "opencode", workingDirectory), []],
    ]);
    const snapshotRequests: Array<{ directories?: string[] }> = [];

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "recover_runtime_attachment",
        requestedSessionId: "external-1",
        shouldReconcileLiveSessions: true,
        historyPolicy: "none",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime("/tmp/repo")]],
        ]),
        preloadedSessionPresenceByKey,
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listSessionPresence: async (input: ListSessionPresenceInput) => {
          snapshotRequests.push(input.directories ? { directories: input.directories } : {});
          return [];
        },
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const resolution = await planner.resolveHydrationRuntime(createRecord({ workingDirectory }));

    expect(snapshotRequests).toEqual([]);
    expect(resolution).toEqual({
      ok: true,
      runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
      workingDirectory,
    });
  });

  test("runtime planner prefers the first repo runtime when multiple stdio runtimes share a worktree", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const snapshotRequests: Array<{ directories?: string[] }> = [];

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent({
        mode: "recover_runtime_attachment",
        requestedSessionId: "external-1",
        shouldReconcileLiveSessions: true,
        historyPolicy: "none",
      }),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          [
            "opencode",
            [
              createStdioRuntime("runtime-stdio-root", "/tmp/repo"),
              createStdioRuntime("runtime-stdio-other", "/tmp/repo"),
            ],
          ],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        listSessionPresence: async (input: ListSessionPresenceInput) => {
          snapshotRequests.push(input.directories ? { directories: input.directories } : {});
          return [];
        },
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const resolution = await planner.resolveHydrationRuntime(createRecord({ workingDirectory }));

    expect(snapshotRequests).toEqual([]);
    expect(resolution).toEqual({
      ok: true,
      runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
      workingDirectory,
    });
  });

  test("runtime planner reads preloaded live snapshots without a scan adapter", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const liveSnapshot = createSessionPresenceSnapshot("external-1", workingDirectory, {
      title: "Builder Session",
      startedAt: "2026-03-01T09:00:00.000Z",
      status: { type: "busy" },
      pendingApprovals: [],
      pendingQuestions: [],
    });

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent(),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime(workingDirectory)]],
        ]),
        preloadedSessionPresenceByKey: new Map([
          [
            agentSessionPresenceLookupKey("/tmp/repo", "opencode", workingDirectory),
            [
              createSessionPresenceSnapshot("external-1", workingDirectory, {
                title: "Builder Session",
                startedAt: "2026-03-01T09:00:00.000Z",
                status: { type: "busy" },
                pendingApprovals: [],
                pendingQuestions: [],
              }),
            ],
          ],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const snapshot = await planner.readSessionPresence(createRecord({ workingDirectory }));

    expect(snapshot).toEqual(liveSnapshot);
  });

  test("runtime planner falls back to single snapshot read after preloaded-only cache miss", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const sessionPresenceSnapshot = createSessionPresenceSnapshot("external-1", workingDirectory, {
      title: "Builder Session",
      startedAt: "2026-03-01T09:00:00.000Z",
      status: { type: "busy" },
      pendingApprovals: [],
      pendingQuestions: [],
    });
    const readPresenceCalls: Array<{ externalSessionId: string; workingDirectory: string }> = [];

    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent(),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          ["opencode", [createRuntime(workingDirectory)]],
        ]),
        preloadedSessionPresenceByKey: new Map([
          [agentSessionPresenceLookupKey("/tmp/repo", "opencode", workingDirectory), []],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        readSessionPresence: async (input) => {
          readPresenceCalls.push({
            externalSessionId: input.externalSessionId,
            workingDirectory: input.workingDirectory,
          });
          return sessionPresenceSnapshot;
        },
      },
      recordsToHydrate: [createRecord({ workingDirectory })],
    });

    const snapshot = await planner.readSessionPresence(createRecord({ workingDirectory }));

    expect(snapshot).toEqual(sessionPresenceSnapshot);
    expect(readPresenceCalls).toEqual([{ externalSessionId: "external-1", workingDirectory }]);
  });

  test("reconciles sessions through single presence reads when scans are unavailable", async () => {
    const stateHarness = createStateHarness({ "external-1": createSession() });
    const adapter = createLifecycleAdapter();
    let readPresenceCalls = 0;
    delete adapter.listSessionPresence;

    const result = await reconcileLiveSessionsStage({
      intent: createIntent({ shouldReconcileLiveSessions: true }),
      adapter,
      updateSession: stateHarness.updateSession,
      attachSessionListener: () => {},
      isStaleRepoOperation: () => false,
      recordsToHydrate: [createRecord()],
      runtimePlanner: {
        repoPath: "/tmp/repo",
        resolveHydrationRuntime: async () => ({
          ok: true,
          runtimeRef: { repoPath: "/tmp/repo", runtimeKind: "opencode" },
          workingDirectory: "/tmp/repo/worktree",
        }),
        readSessionPresence: async () => {
          readPresenceCalls += 1;
          return createStalePresence("external-1", "/tmp/repo/worktree");
        },
      },
      promptAssembler: {
        buildHydrationPreludeMessages: async () => [],
        buildHydrationSystemPrompt: async () => "",
      },
      getRepoPromptOverrides: async () => ({}),
    });

    expect(readPresenceCalls).toBe(1);
    expect(result.reattachedSessionIds.size).toBe(0);
  });

  test("runtime planner uses preloaded snapshots to disambiguate same-directory stdio runtimes", async () => {
    const workingDirectory = "/tmp/repo/worktree";
    const planner = await createRuntimeResolutionPlannerStage({
      intent: createIntent(),
      options: {
        preloadedRuntimeLists: new Map<RuntimeKind, RuntimeInstanceSummary[]>([
          [
            "opencode",
            [
              createStdioRuntime("runtime-stdio-a", workingDirectory),
              createStdioRuntime("runtime-stdio-b", workingDirectory),
            ],
          ],
        ]),
        preloadedSessionPresenceByKey: new Map([
          [
            agentSessionPresenceLookupKey("/tmp/repo", "opencode", workingDirectory),
            [
              createSessionPresenceSnapshot("external-1", workingDirectory, {
                title: "Builder Session",
                startedAt: "2026-03-01T09:00:00.000Z",
                status: { type: "busy" },
                pendingApprovals: [],
                pendingQuestions: [],
              }),
            ],
          ],
        ]),
      },
      adapter: {
        hasSession: () => false,
        loadSessionHistory: async () => [],
        attachSession: async (input: AttachSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
        resumeSession: async (input: ResumeSessionInput) => ({
          externalSessionId: input.externalSessionId,
          role: input.role,
          startedAt: "2026-03-01T09:00:00.000Z",
          status: "idle",
          runtimeKind: input.runtimeKind,
        }),
      },
      recordsToHydrate: [createRecord({ role: "planner", workingDirectory })],
    });

    const result = await planner.resolveHydrationRuntime(
      createRecord({ role: "planner", workingDirectory }),
    );
    if (!result.ok) {
      throw new Error("Expected runtime resolution to succeed");
    }

    expect(result.runtimeRef).toEqual({ repoPath: "/tmp/repo", runtimeKind: "opencode" });
    expect(result.workingDirectory).toBe(workingDirectory);
  });

  test("prompt assembler omits system prompt when the task is unavailable", async () => {
    const assembler = createHydrationPromptAssemblerStage({
      taskId: "task-1",
      taskRef: { current: [] },
    });

    const [prelude, systemPrompt] = await Promise.all([
      assembler.buildHydrationPreludeMessages({
        record: createRecord({ role: "planner" }),
        promptOverrides: {},
      }),
      assembler.buildHydrationSystemPrompt({
        record: createRecord({ role: "planner" }),
        promptOverrides: {},
      }),
    ]);

    expect(systemPrompt).toBe("");
    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: prelude })).toBe(0);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: prelude }, 0),
    ).toBeUndefined();
  });

  test("prompt assembler can skip synthetic prelude messages entirely", async () => {
    const assembler = createHydrationPromptAssemblerStage({
      taskId: "task-1",
      taskRef: { current: [createTaskFixture()] },
      historyPreludeMode: "none",
    });

    const [prelude, systemPrompt] = await Promise.all([
      assembler.buildHydrationPreludeMessages({
        record: createRecord({ role: "planner" }),
        promptOverrides: {},
      }),
      assembler.buildHydrationSystemPrompt({
        record: createRecord({ role: "planner" }),
        promptOverrides: {},
      }),
    ]);

    expect(systemPrompt).toBe("");
    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: prelude })).toBe(0);
  });

  test("prompt assembler builds system prompt and header messages when the task exists", async () => {
    const assembler = createHydrationPromptAssemblerStage({
      taskId: "task-1",
      taskRef: { current: [createTaskFixture()] },
    });

    const [systemPrompt, prelude] = await Promise.all([
      assembler.buildHydrationSystemPrompt({
        record: createRecord({ role: "planner" }),
        promptOverrides: {},
      }),
      assembler.buildHydrationPreludeMessages({
        record: createRecord({ role: "planner" }),
        promptOverrides: {},
      }),
    ]);

    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(getSessionMessageCount({ externalSessionId: "external-1", messages: prelude })).toBe(1);
    expect(
      sessionMessageAt({ externalSessionId: "external-1", messages: prelude }, 0),
    ).toMatchObject({
      id: "history:system-prompt:external-1",
      content: `System prompt:\n\n${systemPrompt}`,
    });
  });
});
