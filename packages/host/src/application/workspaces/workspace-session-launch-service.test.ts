import { afterEach, beforeEach, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import type {
  StartupOperationSnapshot,
  WorkspaceSessionLaunchRequest,
} from "@openducktor/contracts";
import { HostOperationError } from "../../effect/host-errors";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import {
  createStartupProgressRecorder,
  CurrentStartupProgress,
} from "../agent-sessions/session-startup-progress";
import { createWorkspaceSessionLaunchService } from "./workspace-session-launch-service";
import {
  createPersistenceHarness,
  waitFor,
} from "./test-support/workspace-session-runtime-persistence-harness";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { workspaceSessionCatalog } from "../../test-support/workspace-session-ownership";

let database: SqliteTaskStoreTestHarness;
beforeEach(async () => {
  database = await createSqliteTaskStoreHarness();
});
afterEach(async () => {
  await database.cleanup();
});

const yieldToFibers = Effect.gen(function* () {
  for (let index = 0; index < 20; index += 1) yield* Effect.yieldNow;
});

const launchRequest = (
  h: Awaited<ReturnType<typeof createPersistenceHarness>>,
  overrides: Partial<WorkspaceSessionLaunchRequest> = {},
): WorkspaceSessionLaunchRequest => {
  const base = {
    workspaceId: h.storeRef.workspaceId,
    repoPath: h.storeRef.repoPath,
    draftId: "draft-1",
    runtimeKind: h.record.runtimeKind,
    selectedModel: h.record.selectedModel,
    customAgentRoleId: null,
    targetBranch: { remote: "origin", branch: "main" },
    location: "local_repo_root" as const,
    parts: [{ kind: "text" as const, text: "First message" }],
    ...overrides,
  };
  // SAFETY: test fixture merges partial overrides onto a valid base WorkspaceSessionLaunchRequest.
  return base as WorkspaceSessionLaunchRequest;
};

const runWithProgress = <A, E>(
  effect: Effect.Effect<A, E>,
  repoPath: string,
  draftId = "draft-1",
) => {
  const snapshots: StartupOperationSnapshot[] = [];
  const progress = createStartupProgressRecorder(
    {
      context: { startupAttemptId: "attempt-1", operationId: "op-1" },
      hostInstanceId: "host-1",
      workspaceId: "fairnest",
      repoPath,
      scope: { kind: "workspace", draftId },
    },
    (snapshot) => snapshots.push(snapshot),
    (ref) =>
      Effect.succeed({
        ref,
        runtimeId: "runtime-1",
        liveStateSequence: 1,
      }),
    () => Effect.void,
  );
  return Effect.runPromise(
    effect.pipe(Effect.provideService(CurrentStartupProgress, progress)),
  ).then((result) => ({ result, snapshots }));
};

test.each(["opencode", "codex", "claude"] as const)(
  "creates, binds, and sends a deferred workspace session in current checkout: %s",
  async (kind) => {
    const h = await createPersistenceHarness(database, kind, true);
    h.ref.workingDirectory = database.repoPath;
    const service = h.launchService();
    const request = launchRequest(h);
    const { result, snapshots } = await runWithProgress(service.launch(request), database.repoPath);

    expect(result.status).toBe("completed");
    expect(result.sessionId).toBeDefined();
    expect(result.record).toMatchObject({
      id: result.sessionId,
      runtimeKind: kind,
      externalSessionId: h.ref.externalSessionId,
      executionTarget: { kind: "local_repo_root", workingDirectory: database.repoPath },
    });
    expect(result.acceptedMessage).toBeDefined();
    expect(h.starts).toHaveLength(1);
    expect(h.inputs).toHaveLength(1);

    const stepIds = snapshots.at(-1)?.steps.map((step) => step.id) ?? [];
    expect(stepIds).toContain("checkout");
    expect(stepIds).toContain("prepare");
    expect(stepIds).toContain("instruction");
    expect(snapshots.at(-1)?.prepared).toMatchObject({
      runtimeId: "runtime-1",
      liveStateSequence: 1,
    });
  },
);

test("pre-save failure rolls back worktree resources and omits sessionId and record", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const removedWorktrees: string[] = [];
  const deletedBranches: string[] = [];
  const createdWorktrees: Array<{ path: string; branch: string }> = [];
  const existingPaths = new Set<string>();
  const config = repoConfigFixture({
    workspaceId: "fairnest",
    workspaceName: "Fairnest",
    repoPath: database.repoPath,
    branchPrefix: "feat",
    worktreeCopyPaths: [".env"],
  });

  const service = createWorkspaceSessionLaunchService({
    settings: {
      getRepoConfig: () => Effect.succeed(config),
      getWorkspaceCatalog: () => Effect.succeed(workspaceSessionCatalog(config)),
      listCustomAgentRoles: () => Effect.succeed([]),
    },
    store: {
      ...h.store,
      create: () =>
        Effect.fail(new HostOperationError({ operation: "store.create", message: "SQLite busy" })),
    },
    runtime: {
      requireReady: () =>
        Effect.succeed({
          runtimeId: "runtime",
          kind: "codex",
          // SAFETY: test double never inspects runtime descriptor fields.
          descriptor: {} as never,
          runtimeRoute: { type: "local_http", endpoint: "http://localhost:1234" },
          startedAt: "2026-09-07T10:00:00Z",
        }),
    },
    operationGate: h.operationGate,
    live: h.live,
    commands: h.live,
    chatNaming: {
      registerCreated: h.persistence.registerCreated,
    },
    markTitleSyncPending: h.persistence.markTitleSyncPending,
    naming: {
      generate: () => Effect.succeed({ status: "disabled" as const }),
    },
    // SAFETY: test double only passes text parts, which are identical in both part shapes.
    resolveParts: (parts) => Effect.succeed(parts as never),
    publishUpdated: () => Effect.void,
    lifecycle: {
      acquireWorktreeRead: () => Effect.succeed(1),
      acquireWorktreeLifecycle: () => Effect.void,
    },
    git: createGitPortTestDouble({
      canonicalizePath: (p) => Effect.succeed(p),
      isGitRepository: () => Effect.succeed(true),
      listRefNames: () => Effect.succeed([]),
      listRemoteNames: () => Effect.succeed(["origin"]),
      referenceExists: (_repo, ref) => Effect.succeed(ref === "refs/remotes/origin/main"),
      createWorktree: (_repo, path, branch) =>
        Effect.sync(() => {
          existingPaths.add(path);
          createdWorktrees.push({ path, branch });
        }),
      configureBranchUpstream: () => Effect.succeed(null),
      isRegisteredWorktree: (_repo, path) => Effect.succeed(existingPaths.has(path)),
      removeWorktree: (_repo, path) =>
        Effect.sync(() => {
          existingPaths.delete(path);
          removedWorktrees.push(path);
        }),
      deleteLocalBranch: (_repo, branch) =>
        Effect.sync(() => {
          deletedBranches.push(branch);
        }),
      deleteOwnedReference: () => Effect.void,
    }),
    settingsConfig: createSettingsConfigTestDouble({
      defaultWorktreeBasePath: () => "/worktrees/fairnest",
      join: (...parts) => parts.join("/"),
      pathExists: (path) => Effect.succeed(existingPaths.has(path)),
    }),
    worktreeFiles: createWorktreeFilePortTestDouble({
      ensureDirectory: () => Effect.void,
      copyConfiguredPaths: () => Effect.void,
      pathIsWithinRoot: () => Effect.succeed(true),
      removePathIfPresent: () => Effect.void,
      resolveWorktreeRemovalPath: (p) => Effect.succeed(p),
    }),
    worktreeActions: {
      createRun: () => ({
        run: () => Effect.void,
        stopTerminals: () => Effect.void,
      }),
    },
  });

  const { result, snapshots } = await runWithProgress(
    service.launch(
      launchRequest(h, {
        location: "local_worktree",
        worktree: { mode: "from_name", name: "", branchName: null },
        parts: [{ kind: "text", text: "Fix login redirect loop" }],
      }),
    ),
    database.repoPath,
  );

  expect(result.status).toBe("failed");
  expect(result.sessionId).toBeUndefined();
  expect(result.record).toBeUndefined();
  expect(result.unsentInstruction).toBeUndefined();
  expect(createdWorktrees).toHaveLength(1);
  expect(createdWorktrees[0]?.branch).toBe("feat/fix-login-redirect-loop");
  expect(removedWorktrees).toEqual([createdWorktrees[0]!.path]);
  expect(snapshots.at(-1)?.ownership).toEqual({ state: "unknown" });
  expect(snapshots.at(-1)?.steps.some((step) => step.id === "cleanup")).toBe(true);
});

test("post-save runtime start failure keeps saved record and returns unsentInstruction without rollback", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.ref.workingDirectory = database.repoPath;
  h.state.nativeStart = Effect.fail(
    new HostOperationError({ operation: "startSession", message: "runtime unavailable" }),
  );
  const service = h.launchService();
  const request = launchRequest(h);
  const { result, snapshots } = await runWithProgress(service.launch(request), database.repoPath);

  expect(result.status).toBe("failed");
  expect(result.sessionId).toBeDefined();
  expect(result.record).toMatchObject({
    id: result.sessionId,
    externalSessionId: null,
  });
  expect(result.session).toBeUndefined();
  expect(result.unsentInstruction).toEqual(request.parts);
  expect(snapshots.at(-1)?.ownership).toMatchObject({
    state: "saved",
    target: { kind: "workspace", record: { id: result.sessionId } },
  });
  expect(snapshots.at(-1)?.prepared).toBeUndefined();
});

test("post-bind launch hold snapshot failure keeps bound record and returns unsentInstruction", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.ref.workingDirectory = database.repoPath;
  h.state.failSnapshot = true;
  const service = h.launchService();
  const request = launchRequest(h);
  const { result, snapshots } = await runWithProgress(service.launch(request), database.repoPath);

  expect(result.status).toBe("failed");
  expect(result.sessionId).toBeDefined();
  expect(result.record).toMatchObject({
    id: result.sessionId,
    externalSessionId: "native",
  });
  expect(result.session).toMatchObject({ externalSessionId: "native" });
  expect(result.unsentInstruction).toEqual(request.parts);
  expect(snapshots.at(-1)?.ownership).toMatchObject({
    state: "saved",
    target: { kind: "workspace", record: { id: result.sessionId, externalSessionId: "native" } },
  });
});

test("post-save send failure returns saved bound record, prepared handoff, and unsentInstruction", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.ref.workingDirectory = database.repoPath;
  h.state.failSend = true;
  const service = h.launchService();
  const request = launchRequest(h);
  const { result, snapshots } = await runWithProgress(service.launch(request), database.repoPath);

  expect(result.status).toBe("failed");
  expect(result.sessionId).toBeDefined();
  expect(result.record?.externalSessionId).toBe("native");
  expect(result.session).toMatchObject({ externalSessionId: "native" });
  expect(result.unsentInstruction).toEqual(request.parts);
  expect(result.acceptedMessage).toBeUndefined();
  expect(snapshots.at(-1)?.prepared).toBeDefined();
  expect(snapshots.at(-1)?.instruction).toMatchObject({ state: "not_sent" });
});

test("naming model failure sets warning on naming step and uses prefixed fallback branch", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const createdWorktrees: Array<{ path: string; branch: string }> = [];
  const config = repoConfigFixture({
    workspaceId: "fairnest",
    workspaceName: "Fairnest",
    repoPath: database.repoPath,
    branchPrefix: "odt",
    namingModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5-mini" },
  });

  let createdDir = "";
  const service = createWorkspaceSessionLaunchService({
    settings: {
      getRepoConfig: () => Effect.succeed(config),
      getWorkspaceCatalog: () => Effect.succeed(workspaceSessionCatalog(config)),
      listCustomAgentRoles: () => Effect.succeed([]),
    },
    store: h.store,
    runtime: {
      requireReady: () =>
        Effect.succeed({
          runtimeId: "runtime",
          kind: "codex",
          // SAFETY: test double never inspects runtime descriptor fields.
          descriptor: {} as never,
          runtimeRoute: { type: "local_http", endpoint: "http://localhost:1234" },
          startedAt: "2026-09-07T10:00:00Z",
        }),
    },
    operationGate: h.operationGate,
    live: {
      ...h.live,
      startSession: (input) => {
        h.ref.workingDirectory = input.workingDirectory;
        return h.live.startSession(input);
      },
    },
    commands: h.live,
    chatNaming: {
      registerCreated: h.persistence.registerCreated,
    },
    markTitleSyncPending: h.persistence.markTitleSyncPending,
    naming: {
      generate: () => Effect.succeed({ status: "failed" as const, message: "Rate limited." }),
    },
    // SAFETY: test double only passes text parts, which are identical in both part shapes.
    resolveParts: (parts) => Effect.succeed(parts as never),
    publishUpdated: () => Effect.void,
    lifecycle: {
      acquireWorktreeRead: () => Effect.succeed(1),
      acquireWorktreeLifecycle: () => Effect.void,
    },
    git: createGitPortTestDouble({
      canonicalizePath: (p) => Effect.succeed(p),
      isGitRepository: () => Effect.succeed(true),
      listRefNames: () => Effect.succeed([]),
      listRemoteNames: () => Effect.succeed(["origin"]),
      referenceExists: (_repo, ref) => Effect.succeed(ref === "refs/remotes/origin/main"),
      createWorktree: (_repo, path, branch) =>
        Effect.sync(() => {
          createdDir = path;
          createdWorktrees.push({ path, branch });
        }),
      configureBranchUpstream: () => Effect.succeed(null),
      isRegisteredWorktree: () => Effect.succeed(true),
      readCheckout: (path: string) =>
        Effect.succeed({ root: path, commonDirectory: "/shared/.git" }),
    }),
    settingsConfig: createSettingsConfigTestDouble({
      defaultWorktreeBasePath: () => "/worktrees/fairnest",
      join: (...parts) => parts.join("/"),
      pathExists: () => Effect.succeed(false),
    }),
    worktreeFiles: createWorktreeFilePortTestDouble({
      ensureDirectory: () => Effect.void,
      copyConfiguredPaths: () => Effect.void,
      resolveWorktreeRemovalPath: (p) => Effect.succeed(p),
    }),
    worktreeActions: {
      createRun: () => ({
        run: () => Effect.void,
        stopTerminals: () => Effect.void,
      }),
    },
  });

  const { result, snapshots } = await runWithProgress(
    service.launch(
      launchRequest(h, {
        location: "local_worktree",
        worktree: { mode: "from_name", name: "", branchName: null },
        parts: [{ kind: "text", text: "Add dark mode toggle" }],
      }),
    ),
    database.repoPath,
  );

  expect(result.status).toBe("completed");
  expect(createdWorktrees[0]?.branch).toBe("odt/add-dark-mode-toggle");
  expect(result.record?.executionTarget).toEqual({
    kind: "local_worktree",
    workingDirectory: createdDir,
    branchName: "odt/add-dark-mode-toggle",
    worktreeState: "present",
  });
  const namingStep = snapshots.at(-1)?.steps.find((step) => step.id === "naming");
  expect(namingStep?.warning).toContain("Rate limited.");
});

test("shutdown before native work cancels cleanly without starting a runtime session", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.ref.workingDirectory = database.repoPath;
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  h.state.beforeResolveParts = Deferred.succeed(entered, undefined).pipe(
    Effect.andThen(Deferred.await(release)),
  );
  const service = h.launchService();
  const launch = Effect.runFork(service.launch(launchRequest(h)));
  try {
    await Effect.runPromise(Deferred.await(entered));
    const shutdown = Effect.runFork(service.shutdown());
    await Effect.runPromise(yieldToFibers);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(shutdown));
    const outcome = await Effect.runPromise(Fiber.join(launch));
    expect(outcome.status).toBe("canceled");
    expect(outcome.sessionId).toBeUndefined();
    expect(outcome.record).toBeUndefined();
    expect(h.starts).toEqual([]);
    expect(h.inputs).toEqual([]);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(launch));
  }
});

test("caller interruption does not cancel the host launch worker", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.ref.workingDirectory = database.repoPath;
  const gate = await Effect.runPromise(Deferred.make<void>());
  h.state.beforeBind = Deferred.await(gate);
  const service = h.launchService();
  const caller = Effect.runFork(service.launch(launchRequest(h)));
  await waitFor(() => h.starts.length === 1);
  await Effect.runPromise(Fiber.interrupt(caller));
  await Effect.runPromise(Deferred.succeed(gate, undefined));
  await waitFor(() => h.inputs.length === 1);
  expect(h.starts).toHaveLength(1);
});

test("duplicate launch with the same draftId after save fails without creating a second session", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.ref.workingDirectory = database.repoPath;
  const service = h.launchService();
  const request = launchRequest(h, { draftId: "draft-dup" });

  const first = await runWithProgress(service.launch(request), database.repoPath, "draft-dup");
  expect(first.result.status).toBe("completed");
  expect(first.result.sessionId).toBeDefined();

  const second = await runWithProgress(service.launch(request), database.repoPath, "draft-dup");
  expect(second.result.status).toBe("failed");
  expect(second.result.sessionId).toBe(first.result.sessionId);
  expect(second.result.record?.id).toBe(first.result.sessionId);
  expect(second.result.failure?.message).toContain("already created");
  expect(h.starts).toHaveLength(1);
  expect(h.inputs).toHaveLength(1);
});

test("bindRuntimeSession failure releases created session without leaking result.session or reporting launch failure", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.ref.workingDirectory = database.repoPath;
  h.state.beforeBind = Effect.fail(
    new HostOperationError({
      operation: "workspaceSession.bind",
      message: "SQLite bind failed.",
    }),
  );
  const service = h.launchService();
  const { result } = await runWithProgress(
    service.launch(launchRequest(h, { draftId: "draft-bind-fail" })),
    database.repoPath,
    "draft-bind-fail",
  );
  expect(result.status).toBe("failed");
  expect(result.record?.externalSessionId).toBeNull();
  expect(result.session).toBeUndefined();
  expect(result.failure?.noticeId).toBeUndefined();
  expect(result.failure?.cleanupErrors).toEqual([]);
  expect(h.releases).toHaveLength(1);
});
