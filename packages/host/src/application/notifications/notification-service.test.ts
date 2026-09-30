import { expect, mock, test } from "bun:test";
import {
  globalConfigSchema,
  repoConfigSchema,
  type AgentSessionLiveSnapshot,
  type AgentSessionLiveRef,
  type ExternalTaskSyncEvent,
  type GlobalConfig,
  type NotificationActionOccurrence,
  type NotificationStreamFrame,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { Stream, Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { withNotificationConfigCommit } from "../../adapters/config/notification-settings-config";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import {
  createRuntimeHarness,
  runtime,
} from "../../adapters/agent-sessions/opencode-live-session-adapter.test-support";
import {
  createAgentSessionLiveStateService,
  type AgentSessionLiveStateService,
} from "../agent-sessions/agent-session-live-state-service";
import { createNotificationService } from "./notification-service";
const config = () =>
  globalConfigSchema.parse({
    version: 4,
    workspaces: {
      alpha: repoConfigSchema.parse({
        workspaceId: "alpha",
        workspaceName: "Alpha",
        repoPath: "/alpha",
      }),
      beta: repoConfigSchema.parse({
        workspaceId: "beta",
        workspaceName: "Beta",
        repoPath: "/beta",
      }),
    },
  });
const ref = (repoPath = "/alpha", externalSessionId = "root") => ({
  repoPath,
  externalSessionId,
  workingDirectory: repoPath,
  runtimeKind: "codex" as const,
});
const snapshot = (overrides: Partial<AgentSessionLiveSnapshot> = {}): AgentSessionLiveSnapshot => ({
  ref: ref(),
  activity: "running",
  executionEpisodeId: "episode",
  title: "Native title",
  startedAt: "2026-09-01T00:00:00Z",
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  ...overrides,
});
const question = (requestId: string, blocking = true) => ({
  requestId,
  blocking,
  questions: [{ header: "Choice", question: "What next?", options: [] }],
});
const association = (repoPath = "/alpha", externalSessionId = "root"): WorkspaceSession => ({
  id: `association-${externalSessionId}`,
  runtimeKind: "codex",
  externalSessionId,
  executionTarget: { kind: "local_repo_root", workingDirectory: repoPath },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
});
const transition = (id: string, repoPath = "/alpha"): ExternalTaskSyncEvent => ({
  kind: "tasks_updated",
  eventId: id,
  repoPath,
  taskIds: ["task"],
  removedTaskIds: [],
  taskSnapshots: [],
  statusChanges: [
    { previousStatus: "in_progress", task: { id: "task", title: "Task", status: "blocked" } },
  ],
  emittedAt: "2026-09-01T00:00:00Z",
});
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const occurrences = (frames: NotificationStreamFrame[]) =>
  frames.filter((frame) => frame.type === "occurrence");
const harness = (
  options: {
    baseline?: AgentSessionLiveSnapshot[];
    initialRead?: Promise<void>;
    failWorkspace?: string;
    live?: Pick<AgentSessionLiveStateService, "list">;
  } = {},
) => {
  let saved = config();
  const port: SettingsConfigPort = {
    readConfig: mock(() => Effect.succeed(saved)),
    writeConfig: (next) =>
      Effect.sync(() => {
        saved = next;
      }),
    defaultWorktreeBasePath: (id) => `/${id}/worktrees`,
    defaultRepoWorktreeBasePath: (path) => `${path}/worktrees`,
    resolveConfiguredPath: (path) => path,
    canonicalizePath: (path) => Effect.succeed(path),
    pathExists: () => Effect.succeed(true),
    join: (...parts) => parts.join("/"),
  };
  const listTasks = mock(({ repoPath }: { repoPath: string }) => {
    if (repoPath === options.failWorkspace)
      return Effect.fail(
        new HostOperationError({ operation: "test.read", message: "Task store unavailable" }),
      );
    return options.initialRead
      ? Effect.promise(() => options.initialRead!).pipe(Effect.as([]))
      : Effect.succeed([]);
  });
  const listAssociations = mock(() => Effect.succeed([]));
  const listActive = mock(({ repoPath }: { repoPath: string }) =>
    Effect.succeed([association(repoPath)]),
  );
  const listLive = mock(({ repoPath }: { repoPath: string }) =>
    Effect.succeed((options.baseline ?? []).filter((entry) => entry.ref.repoPath === repoPath)),
  );
  const service = createNotificationService({
    settingsConfig: port,
    tasks: { listTasks, agentSessionsListForTasks: listAssociations },
    live: options.live ?? { list: listLive },
    workspaceSessions: { listActive },
    boundIdentity: (id) => id,
  });
  const frames: NotificationStreamFrame[] = [];
  const failures: unknown[] = [];
  Effect.runFork(
    service.stream.subscribe({ cursor: null }).pipe(
      Stream.runForEach((frame) =>
        Effect.sync(() => {
          frames.push(frame);
        }),
      ),
      Effect.catchAll((cause) =>
        Effect.sync(() => {
          failures.push(cause);
        }),
      ),
    ),
  );
  return {
    service,
    frames,
    failures,
    port,
    listTasks,
    listAssociations,
    listActive,
    listLive,
    config: saved,
  };
};
test.each(["close", "shutdown"])(
  "%s stops a workspace opened through a config write",
  async (stop) => {
    const h = harness();
    const closed = { ...h.config, workspaces: {} };
    await Effect.runPromise(h.port.writeConfig(closed));
    await Effect.runPromise(h.service.initialize());
    const wrapped = withNotificationConfigCommit(h.port, h.service.configCommitted);
    await Effect.runPromise(wrapped.writeConfig(h.config));
    await flush();
    expect(h.listLive).toHaveBeenCalledTimes(2);

    const stopped = await Promise.race([
      Effect.runPromise(stop === "close" ? wrapped.writeConfig(closed) : h.service.dispose()).then(
        () => true,
      ),
      Bun.sleep(250).then(() => false),
    ]);
    expect(stopped).toBe(true);
    await Effect.runPromise(h.service.dispose());
  },
);

test.each(["before", "after"])(
  "saved OpenCode sessions notify without a browser refresh when the runtime joins %s startup",
  async (order) => {
    const savedRef = { ...ref("/beta"), runtimeKind: "opencode" as const };
    const readRoots = mock(() =>
      Effect.succeed([savedRef, { ...savedRef, runtimeKind: "codex" as const }]),
    );
    const live = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      readSessionRootRefs: readRoots,
      faultLog: () => Effect.void,
      publish: () => {},
      observeNotificationInput: (envelope, provenance) =>
        h.service.acceptLive(envelope, provenance),
    });
    const h = harness({ live });
    h.config.activeWorkspace = "alpha";
    h.listActive.mockImplementation(({ repoPath }) =>
      Effect.succeed([{ ...association(repoPath), runtimeKind: "opencode" as const }]),
    );
    const native = createRuntimeHarness({
      sessionSources: [
        {
          externalSessionId: savedRef.externalSessionId,
          workingDirectory: savedRef.workingDirectory,
          sessionAssociation: { kind: "repository" },
          title: "Saved session",
          startedAt: "2026-09-01T00:00:00Z",
          runtimeActivity: "running",
          pendingApprovals: [],
          pendingQuestions: [question("baseline")],
        },
      ],
    });
    const rootBatches: AgentSessionLiveRef[][] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: live,
        prepareRuntime: async (input) => {
          const prepared = await native.prepareRuntime(input);
          return {
            ...prepared,
            connection: {
              ...prepared.connection,
              readSessionSources: async (roots) => {
                rootBatches.push(roots ?? []);
                const read = await prepared.connection.readSessionSources(roots);
                return {
                  ...read,
                  sources: read.sources.filter((source) =>
                    roots?.some(
                      (root) =>
                        root.externalSessionId === source.externalSessionId &&
                        root.workingDirectory === source.workingDirectory,
                    ),
                  ),
                };
              },
            },
          };
        },
      })({ ...runtime, repoPath: "/beta", workingDirectory: "/beta" }),
    );
    try {
      if (order === "after") {
        await Effect.runPromise(h.service.initialize());
        await flush();
      }
      await Effect.runPromise(live.registerRuntimeAdapter(prepared.adapter));
      await Effect.runPromise(prepared.startForwarding());
      if (order === "before") await Effect.runPromise(h.service.initialize());
      await flush();
      expect(readRoots).toHaveBeenCalledWith("/beta");
      expect(rootBatches).toEqual([[savedRef]]);
      expect(await Effect.runPromise(live.list({ repoPath: "/beta" }))).toMatchObject([
        { ref: savedRef, title: "Saved session" },
      ]);
      expect(occurrences(h.frames)).toEqual([]);

      await native.emit({
        type: "session_event",
        externalSessionId: savedRef.externalSessionId,
        event: {
          type: "question_required",
          externalSessionId: savedRef.externalSessionId,
          timestamp: "2026-09-01T00:01:00Z",
          ...question("live"),
        },
      });
      await flush();
      expect(occurrences(h.frames).map((frame) => frame.selected.occurrence)).toMatchObject([
        {
          kind: "agent.question_asked",
          repoPath: "/beta",
          repositoryLabel: "Beta",
          navigationTarget: {
            inputKind: "question",
            session: {
              externalSessionId: savedRef.externalSessionId,
              runtimeKind: savedRef.runtimeKind,
              workingDirectory: savedRef.workingDirectory,
            },
          },
        },
      ]);
      await native.emit({
        type: "session_event",
        externalSessionId: savedRef.externalSessionId,
        event: {
          type: "session_error",
          externalSessionId: savedRef.externalSessionId,
          timestamp: "2026-09-01T00:02:00Z",
          message: "Turn failed.",
        },
      });
      await flush();
      expect(occurrences(h.frames).map((frame) => frame.selected.occurrence.kind)).toEqual([
        "agent.question_asked",
        "agent.session_error",
      ]);
      expect(readRoots).toHaveBeenCalledTimes(1);
      expect(native.sessionSourceReadCalls).toBe(1);
      expect(native.controlCalls).toEqual([]);
    } finally {
      await Effect.runPromise(h.service.dispose());
      await Effect.runPromise(live.releaseRuntime(runtime.runtimeId));
    }
  },
);
test("two browsers add no notification baseline reads and share ordered committed transitions", async () => {
  const h = harness();
  try {
    await Effect.runPromise(h.service.initialize());
    await flush();
    const second: NotificationStreamFrame[] = [];
    Effect.runFork(
      h.service.stream.subscribe({ cursor: null }).pipe(
        Stream.runForEach((frame) =>
          Effect.sync(() => {
            second.push(frame);
          }),
        ),
        Effect.ignore,
      ),
    );
    const event = transition("mutation");
    if (event.kind === "tasks_updated")
      event.statusChanges.push(
        { previousStatus: "blocked", task: { id: "task", title: "Task", status: "in_progress" } },
        { previousStatus: "in_progress", task: { id: "task", title: "Task", status: "blocked" } },
      );
    h.service.acceptTask(event);
    h.service.acceptTask(event);
    h.service.acceptTask(transition("beta-mutation", "/beta"));
    await flush();
    expect(occurrences(h.frames)).toEqual(occurrences(second));
    expect(occurrences(h.frames).map((frame) => frame.selected.occurrence.kind)).toEqual([
      "workflow.blocked",
      "workflow.in_progress",
      "workflow.blocked",
      "workflow.blocked",
    ]);
    expect(h.port.readConfig).toHaveBeenCalledTimes(1);
    expect(h.listTasks).toHaveBeenCalledTimes(2);
    expect(h.listLive).toHaveBeenCalledTimes(2);
    expect(h.listActive).toHaveBeenCalledTimes(2);
    expect(h.listAssociations).toHaveBeenCalledTimes(2);
  } finally {
    await Effect.runPromise(h.service.dispose());
  }
});
test("baseline pending input is silent; live input during initialization survives later reads", async () => {
  const gate = Promise.withResolvers<void>();
  const h = harness({
    initialRead: gate.promise,
    baseline: [snapshot({ pendingQuestions: [question("baseline"), question("live")] })],
  });
  try {
    await Effect.runPromise(h.service.initialize());
    h.service.acceptLive(
      { type: "session_upsert", session: snapshot({ pendingQuestions: [question("baseline")] }) },
      "baseline",
    );
    h.service.acceptLive(
      {
        type: "session_upsert",
        session: snapshot({ pendingQuestions: [question("baseline"), question("live")] }),
      },
      "live",
    );
    gate.resolve();
    await flush();
    expect(
      occurrences(h.frames).map((frame) => frame.selected.occurrence.navigationTarget),
    ).toEqual([
      {
        type: "pending_input",
        repoPath: "/alpha",
        session: { externalSessionId: "root", runtimeKind: "codex", workingDirectory: "/alpha" },
        inputKind: "question",
        requestId: "live",
      },
    ]);
    h.service.acceptLive(
      {
        type: "session_upsert",
        session: snapshot({ pendingQuestions: [question("baseline"), question("live")] }),
      },
      "live",
    );
    await flush();
    expect(occurrences(h.frames)).toHaveLength(1);
  } finally {
    gate.resolve();
    await Effect.runPromise(h.service.dispose());
  }
});
test.each(["question", "approval", "removed"])(
  "initialization cancels a resolved %s before ownership becomes available",
  async (kind) => {
    const gate = Promise.withResolvers<void>();
    const h = harness({ initialRead: gate.promise });
    try {
      await Effect.runPromise(h.service.initialize());
      const pending = snapshot({
        pendingQuestions: kind === "approval" ? [] : [question("resolved")],
        pendingApprovals:
          kind === "approval"
            ? [
                {
                  requestId: "resolved",
                  requestType: "command_execution",
                  title: "Run command",
                  command: { command: "bun test" },
                },
              ]
            : [],
      });
      h.service.acceptLive({ type: "session_upsert", session: pending }, "live");
      h.service.acceptLive(
        kind === "removed"
          ? { type: "session_removed", ref: pending.ref }
          : { type: "session_upsert", session: snapshot() },
        "live",
      );
      gate.resolve();
      await flush();
      expect(occurrences(h.frames)).toEqual([]);
    } finally {
      gate.resolve();
      await Effect.runPromise(h.service.dispose());
    }
  },
);
test("new pending input waits for ownership, resolves silently, and child questions retain ancestor navigation", async () => {
  const h = harness();
  try {
    await Effect.runPromise(h.service.initialize());
    await flush();
    const orphan = snapshot({
      ref: ref("/alpha", "orphan"),
      pendingQuestions: [question("resolved")],
    });
    h.service.acceptLive({ type: "session_upsert", session: orphan }, "live");
    h.service.acceptLive(
      { type: "session_upsert", session: { ...orphan, pendingQuestions: [] } },
      "live",
    );
    h.service.acceptWorkspaceSession("alpha", association("/alpha", "orphan"));
    h.service.acceptLive(
      {
        type: "session_upsert",
        session: snapshot({
          ref: ref("/alpha", "child"),
          parentExternalSessionId: "middle",
          pendingQuestions: [question("child-question", false)],
        }),
      },
      "live",
    );
    h.service.acceptLive(
      {
        type: "session_upsert",
        session: snapshot({ ref: ref("/alpha", "middle"), parentExternalSessionId: "root" }),
      },
      "live",
    );
    h.service.acceptLive({ type: "session_upsert", session: snapshot() }, "live");
    await flush();
    expect(occurrences(h.frames)).toHaveLength(1);
    expect(occurrences(h.frames)[0]?.selected.occurrence.navigationTarget).toMatchObject({
      requestId: "child-question",
      session: { externalSessionId: "root" },
    });
  } finally {
    await Effect.runPromise(h.service.dispose());
  }
});
test("settings commit changes future selections, failed saves do not, and duplicate actions keep original preferences", async () => {
  const h = harness();
  try {
    await Effect.runPromise(h.service.initialize());
    await flush();
    const action: NotificationActionOccurrence = {
      occurrenceId: "start",
      kind: "agent.session_started",
      repoPath: "/alpha",
      repositoryLabel: "Untrusted label",
      status: "Started",
      navigationTarget: {
        type: "agent_session",
        repoPath: "/alpha",
        session: { externalSessionId: "root", runtimeKind: "codex", workingDirectory: "/alpha" },
      },
    };
    const first = await Effect.runPromise(h.service.publishAction(action));
    expect(first.occurrence.repositoryLabel).toBe("Alpha");
    const changed: GlobalConfig = structuredClone(h.config);
    changed.notifications.volumePercent = 0;
    const wrapped = withNotificationConfigCommit(h.port, h.service.configCommitted);
    await Effect.runPromise(wrapped.writeConfig(changed));
    expect(await Effect.runPromise(h.service.publishAction(action))).toEqual(first);
    expect(
      (await Effect.runPromise(h.service.publishAction({ ...action, occurrenceId: "second" })))
        .settings.volumePercent,
    ).toBe(0);
    const failing = withNotificationConfigCommit(
      {
        ...h.port,
        writeConfig: () =>
          Effect.fail(
            new HostOperationError({ operation: "config.write", message: "Write failed" }),
          ),
      },
      h.service.configCommitted,
    );
    await expect(Effect.runPromise(failing.writeConfig(h.config))).rejects.toThrow("Write failed");
    expect(
      (await Effect.runPromise(h.service.publishAction({ ...action, occurrenceId: "third" })))
        .settings.volumePercent,
    ).toBe(0);
    await expect(
      Effect.runPromise(h.service.publishAction({ ...action, status: "Conflicting" })),
    ).rejects.toThrow("Conflicting");
  } finally {
    await Effect.runPromise(h.service.dispose());
  }
});
test("workspace failure is scoped; removal discards late work and re-entry seeds silent state", async () => {
  const gate = Promise.withResolvers<void>();
  const h = harness({
    initialRead: gate.promise,
    failWorkspace: "/beta",
    baseline: [snapshot({ pendingQuestions: [question("existing")] })],
  });
  try {
    await Effect.runPromise(h.service.initialize());
    h.service.acceptTask(transition("removed"));
    const removed = structuredClone(h.config);
    delete removed.workspaces.alpha;
    await Effect.runPromise(h.service.configCommitted(removed));
    gate.resolve();
    await flush();
    expect(occurrences(h.frames)).toHaveLength(0);
    expect(
      h.frames.some(
        (frame) =>
          frame.type === "health" &&
          frame.health.scope === "/beta" &&
          frame.health.message?.includes("Task store unavailable"),
      ),
    ).toBe(true);
    await Effect.runPromise(h.service.configCommitted(h.config));
    await flush();
    expect(occurrences(h.frames)).toHaveLength(0);
    h.service.acceptLive(
      {
        type: "session_upsert",
        session: snapshot({ pendingQuestions: [question("existing"), question("new")] }),
      },
      "live",
    );
    await flush();
    expect(occurrences(h.frames)).toHaveLength(1);
  } finally {
    gate.resolve();
    await Effect.runPromise(h.service.dispose());
  }
});

test("startup-captured requests and resolutions stay silent with synchronous baseline reads", async () => {
  const h = harness();
  try {
    h.service.acceptLive(
      {
        type: "session_upsert",
        session: snapshot({ pendingQuestions: [question("resolved-before-startup")] }),
      },
      "live",
    );
    h.service.acceptLive({ type: "session_upsert", session: snapshot() }, "live");
    await Effect.runPromise(h.service.initialize());
    await flush();
    expect(occurrences(h.frames)).toEqual([]);
  } finally {
    await Effect.runPromise(h.service.dispose());
  }
});
