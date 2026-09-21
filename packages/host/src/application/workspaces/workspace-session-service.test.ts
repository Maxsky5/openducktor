import {
  readWorkspaceSessionArchivePreview,
  removeWorkspaceSessionWorktree,
} from "./workspace-session-worktree-lifecycle";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type AgentSessionControlStartInput,
  type AgentSessionLiveReadResult,
  type WorkspaceSessionCreateInput,
  type WorkspaceSession,
  repoConfigSchema,
} from "@openducktor/contracts";
import { Cause, Deferred, Effect, Exit, Fiber, Option, TestClock, TestContext } from "effect";
import { createRuntimeRegistry } from "../../adapters/runtimes/runtime-registry";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { HostOperationError, HostResourceError } from "../../effect/host-errors";
import { hostInvokeFailureFromError } from "../../interface/router/host-invoke-failure";
import { createWorkspaceSessionCommandHandlers } from "../../interface/commands/workspace-session-command-handlers";
import {
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../../interface/router/host-command-router";
import { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import {
  createGitPortTestDouble,
  createSettingsConfigTestDouble,
  createWorktreeFilePortTestDouble,
} from "../../test-support/service-test-doubles";
import {
  createWorkspaceSessionService,
  type WorkspaceSessionServiceDependencies,
} from "./workspace-session-service";

const input = (): WorkspaceSessionCreateInput => ({
  workspaceId: "fairnest",
  runtimeKind: "opencode",
  selectedModel: {
    runtimeKind: "opencode",
    providerId: "provider",
    modelId: "model",
    variant: "high",
    profileId: "profile",
  },
  customAgentRoleId: "role-1",
  location: "local_repo_root",
  manualTitle: "  My   session  ",
});

const worktreeInput = (): WorkspaceSessionCreateInput => ({
  ...input(),
  location: "local_worktree",
  worktree: { mode: "from_name", name: "my-feature", branchName: null },
});

describe("host-owned Workspace Session lifecycle", () => {
  let database: SqliteTaskStoreTestHarness;
  beforeEach(async () => {
    database = await createSqliteTaskStoreHarness();
  });
  afterEach(async () => {
    await database.cleanup();
  });

  const setup = () => {
    const calls: string[] = [];
    const starts: AgentSessionControlStartInput[] = [];
    const titles: string[] = [];
    const paths = new Set<string>();
    const branches = new Set<string>();
    const registered = new Set<string>();
    const config = repoConfigSchema.parse({
      workspaceId: "fairnest",
      workspaceName: "Fairnest",
      repoPath: database.repoPath,
      branchPrefix: "odt",
      worktreeCopyPaths: [".env"],
      hooks: { preStart: ["setup --local"], postComplete: [] },
    });
    const roles = [{ id: "role-1", name: "Reviewer", systemPrompt: "Original prompt." }];
    const state = {
      failStart: false,
      failSave: false,
      failBind: false,
      failStop: false,
      failRename: false,
      failHook: false,
      failCleanup: false,
      failDelete: false,
      failArchive: false,
      failRestore: false,
      partialCreate: false,
      changed: false,
      collision: false,
      validGit: true,
      // SAFETY: The initial literal belongs to the union of states used by this test fake.
      observation: "missing" as "missing" | "running" | "error",
      worktree: "",
      branch: "",
      createBranch: false,
      // SAFETY: The fake records the optional Git start point after creation.
      startPoint: undefined as string | undefined,
    };
    const store = createSqliteWorkspaceSessionStore(database.contextProvider);
    const failure = (message: string) =>
      Effect.fail(new HostOperationError({ operation: "test", message }));
    const dependencies: WorkspaceSessionServiceDependencies = {
      lifecycle: createTaskSessionLifecycleCoordinator(),
      operationGate: createWorkspaceSessionOperationGate(),
      store: {
        ...store,
        archive: (request) =>
          state.failArchive ? failure("database archive failed") : store.archive(request),
        restore: (request) =>
          state.failRestore ? failure("database restore failed") : store.restore(request),
        create: (request) => {
          calls.push("save");
          return state.failSave ? failure("database write failed") : store.create(request);
        },
        bindRuntimeSession: (request) => {
          calls.push("bind");
          return state.failBind
            ? failure("database bind failed")
            : store.bindRuntimeSession(request);
        },
      },
      settings: {
        getRepoConfig: () => Effect.succeed(config),
        listCustomAgentRoles: () => Effect.succeed(roles),
      },
      git: createGitPortTestDouble({
        canonicalizePath: (value) => Effect.succeed(value),
        isGitRepository: () => Effect.succeed(state.validGit),
        getCurrentBranch: (directory) =>
          Effect.succeed({
            name: directory === config.repoPath ? "main" : state.branch,
            detached: false,
          }),
        getStatus: () =>
          Effect.succeed(
            state.changed ? [{ path: "changed.ts", status: "modified", staged: false }] : [],
          ),
        referenceExists: (_repo, reference) =>
          Effect.succeed(reference === "origin/main" || state.collision || branches.has(reference)),
        listBranches: () =>
          Effect.succeed(
            [...branches].map((reference) => ({
              name: reference.replace(/^refs\/heads\//, ""),
              isCurrent: false,
              isRemote: false,
            })),
          ),
        shareGitCommonDirectory: () => Effect.succeed(true),
        isRegisteredWorktree: (_repo, directory) => Effect.succeed(registered.has(directory)),
        createWorktree: (_repo, directory, branch, createBranch, startPoint) =>
          Effect.suspend(() => {
            calls.push("worktree");
            state.createBranch = createBranch;
            state.startPoint = startPoint;
            state.worktree = directory;
            state.branch = branch;
            branches.add(`refs/heads/${branch}`);
            paths.add(directory);
            registered.add(directory);
            return state.partialCreate ? failure("git add failed after creation") : Effect.void;
          }),
        removeWorktree: (_repo, directory) =>
          Effect.suspend(() => {
            calls.push("remove-worktree");
            if (state.failCleanup) return failure("worktree removal failed");
            paths.delete(directory);
            registered.delete(directory);
            return Effect.void;
          }),
        deleteLocalBranch: (_repo, branch) =>
          Effect.suspend(() => {
            calls.push("delete-branch");
            if (state.failDelete) return failure("branch removal failed");
            branches.delete(`refs/heads/${branch}`);
            return Effect.void;
          }),
      }),
      settingsConfig: createSettingsConfigTestDouble({
        defaultWorktreeBasePath: () => path.join(database.configDir, "worktrees"),
        resolveConfiguredPath: (value) => value,
        join: path.join,
        pathExists: (value) => Effect.succeed(paths.has(value)),
      }),
      worktreeFiles: createWorktreeFilePortTestDouble({
        resolveWorktreeRemovalPath: (value) => Effect.succeed(value),
        ensureDirectory: () => Effect.void,
        copyConfiguredPaths: (_repo, _directory, copyPaths) =>
          Effect.sync(() => {
            expect(copyPaths).toEqual([".env"]);
            calls.push("copy");
          }),
        pathIsWithinRoot: () => Effect.succeed(true),
        removePathIfPresent: (value) =>
          Effect.sync(() => {
            paths.delete(value);
          }),
      }),
      systemCommands: {
        resolveCommandPath: () => Effect.dieMessage("Unexpected command lookup"),
        versionCommand: () => Effect.dieMessage("Unexpected version command"),
        runCommandAllowFailure: (command, args, options) =>
          Effect.sync(() => {
            calls.push("hook");
            expect(command).toBe("setup");
            expect(args).toEqual(["--local"]);
            expect(options?.cwd).toBe(state.worktree);
            return { ok: !state.failHook, stdout: "", stderr: state.failHook ? "hook failed" : "" };
          }),
      },
      runtime: {
        runtimeEnsure: ({ repoPath }) =>
          Effect.sync(() => {
            calls.push("ensure-runtime");
            return {
              kind: "opencode",
              runtimeId: "runtime",
              repoPath,
              taskId: null,
              role: "workspace",
              workingDirectory: repoPath,
              runtimeRoute: { type: "local_http", endpoint: "http://localhost:1234" },
              startedAt: "2026-09-07T00:00:00Z",
              descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
            };
          }),
      },
      live: {
        startSession: (request) =>
          Effect.suspend(() => {
            calls.push("start");
            starts.push(request);
            if (state.failStart) return failure("runtime start failed");
            return Effect.succeed({
              externalSessionId: `native-${starts.length}`,
              runtimeKind: request.runtimeKind,
              workingDirectory: request.workingDirectory,
              startedAt: "2026-09-07T00:00:00Z",
              status: "idle",
            });
          }),
        releaseSession: () =>
          Effect.sync(() => {
            calls.push("release");
          }),
        stopSession: () =>
          Effect.suspend(() => {
            calls.push("stop");
            return state.failStop ? failure("stop failed") : Effect.void;
          }),
        updateSessionTitle: (request) =>
          Effect.suspend(() => {
            calls.push("title");
            if (state.failRename) return failure("runtime rename failed");
            titles.push(request.title);
            return Effect.void;
          }),
        read: (ref) =>
          Effect.suspend(() => {
            if (state.observation === "error") return failure("observation failed");
            const observed: AgentSessionLiveReadResult =
              state.observation === "missing"
                ? { type: "missing", ref }
                : {
                    type: "live",
                    session: {
                      ref,
                      repositoryScope: { kind: "repository" },
                      activity: "running",
                      title: "Runtime title",
                      startedAt: "2026-09-07T00:00:00Z",
                      pendingApprovals: [],
                      pendingQuestions: [],
                      contextUsage: null,
                    },
                  };
            return Effect.succeed(observed);
          }),
      },
    };
    return {
      service: createWorkspaceSessionService(dependencies),
      dependencies,
      calls,
      starts,
      titles,
      state,
      roles,
      paths,
      branches,
      registered,
    };
  };

  test.each(["default target", "checkout"] as const)(
    "protects the %s branch when the stored worktree is missing",
    async (protectedBy) => {
      const h = setup();
      const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
      if (session.executionTarget.kind !== "local_worktree") throw new Error("Expected worktree");
      const target = session.executionTarget;
      const branchName = target.branchName;
      if (branchName === null) throw new Error("Expected named branch");
      h.paths.clear();
      h.registered.clear();
      const config = await Effect.runPromise(h.dependencies.settings.getRepoConfig("fairnest"));
      const protectedConfig = {
        ...config,
        defaultTargetBranch: {
          branch: protectedBy === "default target" ? branchName : "other",
        },
      };
      const dependencies = {
        ...h.dependencies,
        settings: {
          ...h.dependencies.settings,
          getRepoConfig: () => Effect.succeed(protectedConfig),
        },
        git: {
          ...h.dependencies.git,
          getCurrentBranch: () =>
            Effect.succeed({
              name: protectedBy === "checkout" ? branchName : "other",
              detached: false,
            }),
        },
      };
      const service = createWorkspaceSessionService(dependencies);
      h.calls.length = 0;
      await expect(
        Effect.runPromise(
          readWorkspaceSessionArchivePreview(dependencies, protectedConfig, target),
        ),
      ).rejects.toThrow("Cannot delete protected branch");
      await expect(
        Effect.runPromise(
          removeWorkspaceSessionWorktree(
            dependencies,
            protectedConfig,
            target,
            target.workingDirectory,
          ),
        ),
      ).rejects.toThrow("Cannot delete protected branch");
      await expect(
        Effect.runPromise(
          service.archive({
            workspaceId: "fairnest",
            sessionId: session.id,
            confirmStop: true,
            removeWorktree: true,
            worktreeConfirmation: {
              workingDirectory: target.workingDirectory,
              branchName,
            },
          }),
        ),
      ).rejects.toThrow("Cannot delete protected branch");
      expect(h.calls).not.toContain("delete-branch");
      expect(h.branches.has(`refs/heads/${target.branchName}`)).toBe(true);
      expect(
        await Effect.runPromise(service.get({ workspaceId: "fairnest", sessionId: session.id })),
      ).toEqual(session);
    },
  );

  test("archives a detached import after its worktree is removed outside the app", async () => {
    const h = setup();
    const session: WorkspaceSession = {
      id: "detached-import",
      runtimeKind: "opencode",
      externalSessionId: "native-detached",
      executionTarget: {
        kind: "local_worktree",
        workingDirectory: "/missing-detached-worktree",
        branchName: null,
        worktreeState: "present",
      },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: "Detached import",
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    };
    await Effect.runPromise(
      h.dependencies.store.create({
        workspaceId: "fairnest",
        repoPath: database.repoPath,
        session,
      }),
    );

    h.paths.add(session.executionTarget.workingDirectory);
    await expect(
      Effect.runPromise(
        h.service.archive({
          workspaceId: "fairnest",
          sessionId: session.id,
          confirmStop: true,
          removeWorktree: false,
        }),
      ),
    ).rejects.toThrow("not a registered worktree");
    h.paths.clear();

    const archived = await Effect.runPromise(
      h.service.archive({
        workspaceId: "fairnest",
        sessionId: session.id,
        confirmStop: true,
        removeWorktree: false,
      }),
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.executionTarget).toEqual(session.executionTarget);
    await expect(
      Effect.runPromise(h.service.restore({ workspaceId: "fairnest", sessionId: session.id })),
    ).rejects.toThrow("not a registered worktree");
    h.paths.add(session.executionTarget.workingDirectory);
    h.registered.add(session.executionTarget.workingDirectory);
    const restored = await Effect.runPromise(
      h.service.restore({ workspaceId: "fairnest", sessionId: session.id }),
    );
    expect(restored.archivedAt).toBeNull();
  });

  test("first-send startup completes through the real runtime registry cancellation race", async () => {
    const h = setup();
    const runtime = await Effect.runPromise(
      h.dependencies.runtime.runtimeEnsure({
        repoPath: database.repoPath,
        runtimeKind: "opencode",
      }),
    );
    const registry = createRuntimeRegistry({ runtimes: [runtime] });
    const service = createWorkspaceSessionService({
      ...h.dependencies,
      runtime: { runtimeEnsure: registry.ensureWorkspaceRuntime },
    });
    const draft = await Effect.runPromise(service.create(input()));
    const fiber = Effect.runFork(
      service.start({ workspaceId: "fairnest", sessionId: draft.session.id }),
    );
    try {
      const completed = await Effect.runPromise(
        Fiber.await(fiber).pipe(Effect.timeoutOption("200 millis")),
      );
      expect(Option.isSome(completed)).toBe(true);
      const created = await Effect.runPromise(Fiber.join(fiber));
      expect(await Effect.runPromise(service.listActive("fairnest"))).toEqual([created.session]);
    } finally {
      // Release the registry's cancellation branch even when the regression deadlocks creation.
      await Effect.runPromise(registry.stopAllRuntimes());
      await Effect.runPromise(Fiber.await(fiber));
    }
  });

  test.each(["edit", "delete"] as const)(
    "persists a draft and keeps its Role snapshot after a role %s",
    async (change) => {
      const h = setup();
      const created = await Effect.runPromise(h.service.create(input()));
      expect(h.calls).toEqual(["save"]);
      expect(h.starts).toEqual([]);
      expect(created.session.externalSessionId).toBeNull();
      if (change === "edit") h.roles[0]!.systemPrompt = "Edited prompt.";
      else h.roles.splice(0, 1);
      const ref = { workspaceId: "fairnest", sessionId: created.session.id };
      const started = await Effect.runPromise(h.service.start(ref));
      expect(h.calls).toEqual(["save", "ensure-runtime", "start", "bind"]);
      expect(h.starts[0]).toMatchObject({
        repoPath: database.repoPath,
        workingDirectory: database.repoPath,
        sessionScope: { kind: "repository", title: "My session" },
        systemPrompt: "Original prompt.",
        model: input().selectedModel,
      });
      expect(created.session).toMatchObject({
        manualTitle: "My session",
        generatedTitle: null,
        archivedAt: null,
        roleSnapshot: { name: "Reviewer", systemPrompt: "Original prompt." },
        selectedModel: input().selectedModel,
      });
      expect(await Effect.runPromise(h.service.listActive("fairnest"))).toEqual([started.session]);
      expect(await Effect.runPromise(h.service.start(ref))).toEqual({
        session: started.session,
        runtimeSession: null,
      });
      expect(h.starts).toHaveLength(1);
    },
  );

  test("renames the bound runtime session with the new Workspace Session title", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    await Effect.runPromise(h.service.start(ref));
    h.calls.length = 0;

    const renamed = await Effect.runPromise(h.service.rename({ ...ref, manualTitle: "Renamed" }));

    expect(renamed.manualTitle).toBe("Renamed");
    expect(h.titles).toEqual(["Renamed"]);
    expect(h.calls).toEqual(["title"]);
  });

  test("renames a draft without touching a runtime session", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    h.calls.length = 0;

    const renamed = await Effect.runPromise(
      h.service.rename({ workspaceId: "fairnest", sessionId: session.id, manualTitle: "Draft" }),
    );

    expect(renamed.manualTitle).toBe("Draft");
    expect(h.titles).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  test("renames an offline Workspace Session without a live runtime", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    await Effect.runPromise(h.service.start(ref));
    const offline = createWorkspaceSessionService({
      ...h.dependencies,
      live: {
        ...h.dependencies.live,
        updateSessionTitle: () =>
          Effect.fail(
            new HostResourceError({
              resource: "agent_session_live_adapter",
              operation: "resolveForScope",
              message: "No live opencode runtime owns the repository.",
            }),
          ),
      },
    });

    const renamed = await Effect.runPromise(offline.rename({ ...ref, manualTitle: "Renamed" }));

    expect(renamed.manualTitle).toBe("Renamed");
    expect(h.titles).toEqual([]);
  });

  test("fails the rename and keeps the durable title when the runtime rejects it", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    await Effect.runPromise(h.service.start(ref));
    h.state.failRename = true;

    await expect(
      Effect.runPromise(h.service.rename({ ...ref, manualTitle: "Renamed" })),
    ).rejects.toThrow("runtime rename failed");
    expect((await Effect.runPromise(h.service.get(ref))).manualTitle).toBe("My session");
  });

  test("No Role supplies no Role prompt and missing Roles fail before resource creation", async () => {
    const h = setup();
    await expect(
      Effect.runPromise(h.service.create({ ...input(), customAgentRoleId: "deleted" })),
    ).rejects.toThrow("no longer exists");
    expect(h.calls).toEqual([]);
    const created = await Effect.runPromise(
      h.service.create({ ...input(), customAgentRoleId: null, manualTitle: null }),
    );
    expect(created.session.roleSnapshot).toBeNull();
    await Effect.runPromise(
      h.service.start({ workspaceId: "fairnest", sessionId: created.session.id }),
    );
    expect(h.starts[0]?.systemPrompt).toBe("");
  });

  test("worktree creation uses committed HEAD and Workspace setup before runtime startup", async () => {
    const h = setup();
    h.state.changed = true;
    const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
    expect(h.calls).toEqual(["worktree", "copy", "hook", "save"]);
    expect(h.state.worktree).toBe(
      path.join(database.configDir, "worktrees", "workspace-sessions", "my-feature"),
    );
    expect(session.executionTarget.workingDirectory).toBe(h.state.worktree);
    expect(h.state.branch).toBe("odt/my-feature");
    expect(h.state.createBranch).toBe(true);
    expect(h.state.startPoint).toBe("HEAD");
    expect(h.paths.has(h.state.worktree)).toBe(true);
  });

  test("accepts drive-qualified paths from a Windows worktree port", async () => {
    const h = setup();
    h.dependencies.settingsConfig.defaultWorktreeBasePath = () => "C:\\worktrees";
    h.dependencies.settingsConfig.join = path.win32.join;
    const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
    expect(session.executionTarget.workingDirectory).toBe(
      "C:\\worktrees\\workspace-sessions\\my-feature",
    );
    expect(h.calls).toEqual(["worktree", "copy", "hook", "save"]);
  });

  test("uses an explicit new branch name without changing the worktree name", async () => {
    const h = setup();
    await Effect.runPromise(
      h.service.create({
        ...worktreeInput(),
        worktree: { mode: "from_name", name: "review-ui", branchName: "feature/custom-ui" },
      }),
    );
    expect(h.state.worktree).toBe(
      path.join(database.configDir, "worktrees", "workspace-sessions", "review-ui"),
    );
    expect(h.state.branch).toBe("feature/custom-ui");
    expect(h.state.createBranch).toBe(true);
    expect(h.state.startPoint).toBe("HEAD");
  });

  test.each(["from_name", "from_branch"] as const)(
    "%s creation skips checkout status and retains its saved target through archive and restore",
    async (mode) => {
      const h = setup();
      if (mode === "from_branch") h.branches.add("refs/heads/odt/my-feature");
      h.dependencies.git.getStatus = () =>
        Effect.dieMessage("Creation must not read checkout status");
      const events: unknown[] = [];
      const router = toPromiseHostCommandRouter(
        createEffectHostCommandRouter({
          handlers: createWorkspaceSessionCommandHandlers(h.service, (_workspaceId, session) =>
            Effect.sync(() => {
              events.push(session);
            }),
          ),
        }),
      );
      const { session } = await router.invoke("workspace_session_create", {
        ...worktreeInput(),
        worktree: { mode, name: "my-feature", branchName: "odt/my-feature" },
      });
      expect(session.executionTarget.kind).toBe("local_worktree");
      expect(h.calls).toEqual(["worktree", "copy", "hook", "save"]);
      expect(h.starts).toEqual([]);
      const ref = { workspaceId: "fairnest", sessionId: session.id };
      const started = await router.invoke("workspace_session_start", ref);
      expect(h.starts[0]?.workingDirectory).toBe(session.executionTarget.workingDirectory);
      const callsBeforeArchive = [...h.calls];
      const archived = await router.invoke("workspace_session_archive", {
        ...ref,
        confirmStop: false,
      });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.executionTarget).toEqual(session.executionTarget);
      expect(h.registered.has(session.executionTarget.workingDirectory)).toBe(true);
      expect(h.branches.has("refs/heads/odt/my-feature")).toBe(true);
      expect(await Effect.runPromise(h.service.listActive("fairnest"))).toEqual([]);
      expect(await router.invoke("workspace_session_restore", ref)).toEqual(started.session);
      expect(h.calls).toEqual(callsBeforeArchive);
      expect(h.starts).toHaveLength(1);
      expect(events).toEqual([session, started.session, archived, started.session]);
      h.registered.clear();
      await expect(
        router.invoke("workspace_session_archive", {
          ...ref,
          confirmStop: false,
        }),
      ).rejects.toThrow("not a registered worktree");
      expect(await Effect.runPromise(h.service.get(ref))).toEqual(started.session);
      expect(events).toHaveLength(4);
    },
  );

  test("checks out an existing branch directly without creating another branch", async () => {
    const h = setup();
    h.branches.add("refs/heads/feature/existing");
    await Effect.runPromise(
      h.service.create({
        ...worktreeInput(),
        worktree: { mode: "from_branch", name: "existing-review", branchName: "feature/existing" },
      }),
    );
    expect(h.state.worktree).toBe(
      path.join(database.configDir, "worktrees", "workspace-sessions", "existing-review"),
    );
    expect(h.state.branch).toBe("feature/existing");
    expect(h.state.createBranch).toBe(false);
    expect(h.state.startPoint).toBeUndefined();
    expect([...h.branches]).toEqual(["refs/heads/feature/existing"]);
  });

  test("rejects an already checked-out branch without changing it", async () => {
    const h = setup();
    const occupied = "/repos/Fair Nest/other checkout";
    h.branches.add("refs/heads/feature/existing");
    h.dependencies.git.listBranches = () =>
      Effect.succeed([
        { name: "feature/existing", isCurrent: false, isRemote: false, worktreePath: occupied },
      ]);
    const error = await Effect.runPromise(
      Effect.flip(
        h.service.create({
          ...worktreeInput(),
          worktree: { mode: "from_branch", name: "different-name", branchName: "feature/existing" },
        }),
      ),
    );
    expect(hostInvokeFailureFromError(error)).toEqual({
      kind: "workspace_session_validation",
      field: "worktree.branchName",
    });
    expect(error).toMatchObject({
      message: `Branch feature/existing is already checked out at ${occupied}. Choose another branch or use Current checkout.`,
    });
    expect(h.calls).toEqual([]);
    expect([...h.branches]).toEqual(["refs/heads/feature/existing"]);
  });

  test("keeps uncertain resources when Git does not confirm creation", async () => {
    const h = setup();
    h.state.partialCreate = true;
    await expect(Effect.runPromise(h.service.create(worktreeInput()))).rejects.toThrow(
      /Git did not confirm.*my-feature.*odt\/my-feature[\s\S]*git add failed after creation/,
    );
    expect(
      h.paths.has(path.join(database.configDir, "worktrees", "workspace-sessions", "my-feature")),
    ).toBe(true);
    expect(
      h.registered.has(
        path.join(database.configDir, "worktrees", "workspace-sessions", "my-feature"),
      ),
    ).toBe(true);
    expect(h.branches.has("refs/heads/odt/my-feature")).toBe(true);
    expect(h.calls).not.toContain("remove-worktree");
    expect(h.calls).not.toContain("delete-branch");
    expect(await Effect.runPromise(h.service.listActive("fairnest"))).toEqual([]);
  });

  test.each([
    ["create", "my-feature"],
    ["create", "other-directory"],
    ["restore", "my-feature"],
    ["restore", "other-directory"],
  ] as const)("failed %s preserves a competing creation at %s", async (operation, name) => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const archived = await Effect.runPromise(
      h.service.archive({
        ...ref,
        confirmStop: true,
        removeWorktree: true,
        worktreeConfirmation: {
          workingDirectory: session.executionTarget.workingDirectory,
          branchName: "odt/my-feature",
        },
      }),
    );
    h.calls.length = 0;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          let first = true;
          const service = createWorkspaceSessionService({
            ...h.dependencies,
            git: {
              ...h.dependencies.git,
              createWorktree: (...args) =>
                Effect.suspend(() => {
                  if (!first) return h.dependencies.git.createWorktree(...args);
                  first = false;
                  return Deferred.succeed(entered, undefined).pipe(
                    Effect.zipRight(Deferred.await(release)),
                    Effect.zipRight(
                      Effect.fail(
                        new HostOperationError({
                          operation: "git.worktree.add",
                          message: "Another request created the branch",
                        }),
                      ),
                    ),
                  );
                }),
            },
          });
          // Always release acquisition before the scope interrupts its child.
          const loser = yield* Effect.acquireRelease(
            Effect.forkScoped(
              operation === "create"
                ? service.create(worktreeInput()).pipe(Effect.asVoid)
                : service.restore(ref).pipe(Effect.asVoid),
            ),
            () => Deferred.succeed(release, undefined),
          );
          yield* Deferred.await(entered);
          const winner = yield* service.create({
            ...worktreeInput(),
            worktree: { mode: "from_name", name, branchName: "odt/my-feature" },
          });
          yield* Deferred.succeed(release, undefined);
          const failed = yield* Fiber.await(loser);
          expect(Exit.isFailure(failed)).toBe(true);
          if (Exit.isFailure(failed)) {
            expect(Cause.pretty(failed.cause)).toContain("Another request created the branch");
          }
          expect(yield* service.get({ ...ref, sessionId: winner.session.id })).toEqual(
            winner.session,
          );
        }),
      ),
    );
    expect(h.paths.size).toBe(1);
    expect(
      h.paths.has(path.join(database.configDir, "worktrees", "workspace-sessions", name)),
    ).toBe(true);
    expect(
      h.registered.has(path.join(database.configDir, "worktrees", "workspace-sessions", name)),
    ).toBe(true);
    expect(h.branches.has("refs/heads/odt/my-feature")).toBe(true);
    expect(h.calls).not.toContain("remove-worktree");
    expect(h.calls).not.toContain("delete-branch");
    expect(await Effect.runPromise(h.service.get(ref))).toEqual(archived);
  });

  test("retains the saved target when cancellation arrives during persistence", async () => {
    const h = setup();
    const cancellation = new AbortController();
    const service = createWorkspaceSessionService({
      ...h.dependencies,
      store: {
        ...h.dependencies.store,
        create: (request) =>
          h.dependencies.store
            .create(request)
            .pipe(Effect.tap(() => Effect.sync(() => cancellation.abort()))),
      },
    });
    await expect(
      Effect.runPromise(service.create(worktreeInput()), { signal: cancellation.signal }),
    ).rejects.toThrow();
    const saved = await Effect.runPromise(service.listActive("fairnest"));
    expect(saved).toHaveLength(1);
    expect(h.paths.has(saved[0]!.executionTarget.workingDirectory)).toBe(true);
    expect(h.registered.has(saved[0]!.executionTarget.workingDirectory)).toBe(true);
    expect(h.branches.has("refs/heads/odt/my-feature")).toBe(true);
    expect(h.calls).not.toContain("remove-worktree");
    expect(h.calls).not.toContain("delete-branch");
  });

  test.each(["create", "restore"] as const)(
    "%s removes its acquired worktree when setup is interrupted",
    async (operation) => {
      const h = setup();
      const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
      const ref = { workspaceId: "fairnest", sessionId: session.id };
      const archived = await Effect.runPromise(
        h.service.archive({
          ...ref,
          confirmStop: true,
          removeWorktree: true,
          worktreeConfirmation: {
            workingDirectory: session.executionTarget.workingDirectory,
            branchName: "odt/my-feature",
          },
        }),
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>();
            const service = createWorkspaceSessionService({
              ...h.dependencies,
              worktreeFiles: {
                ...h.dependencies.worktreeFiles,
                copyConfiguredPaths: () =>
                  Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Effect.never)),
              },
            });
            const fiber = yield* Effect.forkScoped(
              operation === "create"
                ? service.create(worktreeInput()).pipe(Effect.asVoid)
                : service.restore(ref).pipe(Effect.asVoid),
            );
            yield* Deferred.await(entered);
            const exit = yield* Fiber.interrupt(fiber);
            expect(Exit.isFailure(exit) && Cause.isInterrupted(exit.cause)).toBe(true);
            expect(h.paths.size).toBe(0);
            expect(h.registered.size).toBe(0);
            expect(h.branches.size).toBe(0);
            expect(yield* service.get(ref)).toEqual(archived);
          }),
        ),
      );
    },
  );

  test.each(["partialCreate", "failHook", "failSave"] as const)(
    "preserves an existing branch when creation fails at %s",
    async (failure) => {
      const h = setup();
      h.branches.add("refs/heads/feature/existing");
      h.state[failure] = true;
      await expect(
        Effect.runPromise(
          h.service.create({
            ...worktreeInput(),
            worktree: {
              mode: "from_branch",
              name: "existing-review",
              branchName: "feature/existing",
            },
          }),
        ),
      ).rejects.toThrow();
      expect([...h.branches]).toEqual(["refs/heads/feature/existing"]);
      expect(h.calls).not.toContain("delete-branch");
      const remaining = failure === "partialCreate" ? 1 : 0;
      expect(h.paths.size).toBe(remaining);
      expect(h.registered.size).toBe(remaining);
    },
  );

  test("rejects a missing existing branch without creating resources", async () => {
    const h = setup();
    await expect(
      Effect.runPromise(
        h.service.create({
          ...worktreeInput(),
          worktree: { mode: "from_branch", name: "review", branchName: "missing" },
        }),
      ),
    ).rejects.toThrow("Local branch no longer exists");
    expect(h.calls).toEqual([]);
  });

  test("rejects a directory collision without changing the directory or existing branch", async () => {
    const h = setup();
    h.paths.add(path.join(database.configDir, "worktrees", "workspace-sessions", "review"));
    h.branches.add("refs/heads/feature/existing");
    await expect(
      Effect.runPromise(
        h.service.create({
          ...worktreeInput(),
          worktree: { mode: "from_branch", name: "review", branchName: "feature/existing" },
        }),
      ),
    ).rejects.toThrow("Worktree directory already exists");
    expect([...h.paths]).toEqual([
      path.join(database.configDir, "worktrees", "workspace-sessions", "review"),
    ]);
    expect([...h.branches]).toEqual(["refs/heads/feature/existing"]);
    expect(h.calls).toEqual([]);
  });

  test.each(["worktree path", "registered worktree", "branch"] as const)(
    "rejects an existing %s without changing it",
    async (collision) => {
      const h = setup();
      const directory = path.join(
        database.configDir,
        "worktrees",
        "workspace-sessions",
        "my-feature",
      );
      if (collision === "branch") h.branches.add("refs/heads/odt/my-feature");
      else {
        h.paths.add(directory);
        if (collision === "registered worktree") h.registered.add(directory);
      }
      const error = await Effect.runPromise(Effect.flip(h.service.create(worktreeInput())));
      expect(hostInvokeFailureFromError(error)).toEqual({
        kind: "workspace_session_validation",
        field: collision === "branch" ? "worktree.branchName" : "worktree.name",
      });
      expect(error).toMatchObject({
        message:
          collision === "branch"
            ? "Branch already exists: odt/my-feature. Choose another name or use Existing branch."
            : `Worktree directory already exists: ${directory}. Choose another name.`,
      });
      expect(h.calls).toEqual([]);
      expect(h.branches.has("refs/heads/odt/my-feature")).toBe(collision === "branch");
      expect(h.paths.has(directory)).toBe(collision !== "branch");
      expect(h.registered.has(directory)).toBe(collision === "registered worktree");
    },
  );

  test.each(["../escape", "/absolute", "bad:name", "", ".hidden"])(
    "rejects invalid worktree name %s before creating resources",
    async (name) => {
      const h = setup();
      await expect(
        Effect.runPromise(
          h.service.create({
            ...worktreeInput(),
            worktree: { mode: "from_name", name, branchName: null },
          }),
        ),
      ).rejects.toThrow("Invalid Workspace Session creation input");
      expect(h.calls).toEqual([]);
    },
  );

  test("rejects collisions and invalid titles before Git or runtime creation", async () => {
    const h = setup();
    h.state.collision = true;
    await expect(Effect.runPromise(h.service.create(worktreeInput()))).rejects.toThrow(
      "already exists",
    );
    await expect(
      Effect.runPromise(h.service.create({ ...input(), manualTitle: "x".repeat(121) })),
    ).rejects.toThrow("120 characters");
    expect(h.calls).toEqual([]);
  });

  test.each(["failHook", "failSave"] as const)(
    "rolls back all created Git resources after %s",
    async (failure) => {
      const h = setup();
      h.state[failure] = true;
      await expect(Effect.runPromise(h.service.create(worktreeInput()))).rejects.toThrow();
      expect(h.paths.size).toBe(0);
      expect(h.branches.size).toBe(0);
      expect(h.registered.size).toBe(0);
      expect(h.calls.slice(-2)).toEqual(["remove-worktree", "delete-branch"]);
      expect(h.calls).not.toContain("release");
      expect(await Effect.runPromise(h.service.listActive("fairnest"))).toEqual([]);
    },
  );

  test("reports original failure and cleanup failure together", async () => {
    const h = setup();
    h.state.failSave = true;
    h.state.failCleanup = true;
    await expect(Effect.runPromise(h.service.create(worktreeInput()))).rejects.toThrow(
      /database write failed[\s\S]*worktree removal failed/,
    );
  });

  test("requires confirmation to stop before archive and retains state after Stop or observation failure", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const started = await Effect.runPromise(h.service.start(ref));
    h.state.observation = "running";
    await expect(
      Effect.runPromise(h.service.archive({ ...ref, confirmStop: false, removeWorktree: false })),
    ).rejects.toThrow("Confirm Stop");
    h.state.failStop = true;
    await expect(
      Effect.runPromise(h.service.archive({ ...ref, confirmStop: true, removeWorktree: false })),
    ).rejects.toThrow("stop failed");
    h.state.observation = "error";
    await expect(
      Effect.runPromise(h.service.archive({ ...ref, confirmStop: true, removeWorktree: false })),
    ).rejects.toThrow("observation failed");
    expect((await Effect.runPromise(h.service.get(ref))).archivedAt).toBeNull();
    h.state.observation = "running";
    h.state.failStop = false;
    const archived = await Effect.runPromise(
      h.service.archive({ ...ref, confirmStop: true, removeWorktree: false }),
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.updatedAt).toBe(session.updatedAt);
    await expect(
      Effect.runPromise(h.service.rename({ ...ref, manualTitle: "Other" })),
    ).rejects.toThrow("Restore");
    const restored = await Effect.runPromise(h.service.restore(ref));
    expect(restored).toEqual(started.session);
    expect(h.starts).toHaveLength(1);
  });

  test.each(["missing directory", "unregistered worktree"] as const)(
    "archive rejects %s before Stop or durable mutation",
    async (invalidTarget) => {
      const h = setup();
      const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
      const ref = { workspaceId: "fairnest", sessionId: session.id };
      const started = await Effect.runPromise(h.service.start(ref));
      if (invalidTarget === "missing directory") h.state.validGit = false;
      else h.registered.clear();
      h.state.observation = "running";
      await expect(
        Effect.runPromise(h.service.archive({ ...ref, confirmStop: true, removeWorktree: false })),
      ).rejects.toThrow(/saved canonical Git directory|not a registered worktree/);
      expect(h.calls).not.toContain("stop");
      expect(await Effect.runPromise(h.service.get(ref))).toEqual(started.session);
    },
  );

  test.each(["failStart", "failBind"] as const)(
    "retains the saved draft and worktree after %s",
    async (failure) => {
      const h = setup();
      const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
      const ref = { workspaceId: "fairnest", sessionId: session.id };
      h.state[failure] = true;
      await expect(Effect.runPromise(h.service.start(ref))).rejects.toThrow();
      expect(await Effect.runPromise(h.service.get(ref))).toEqual(session);
      expect(h.paths.has(session.executionTarget.workingDirectory)).toBe(true);
      expect(h.registered.has(session.executionTarget.workingDirectory)).toBe(true);
      expect(h.branches.has("refs/heads/odt/my-feature")).toBe(true);
      expect(h.calls.includes("release")).toBe(failure === "failBind");
      h.state[failure] = false;
      const started = await Effect.runPromise(h.service.start(ref));
      expect(started.session.externalSessionId).not.toBeNull();
    },
  );

  test("concurrent first sends bind one runtime session", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const results = await Promise.all([
      Effect.runPromise(h.service.start(ref)),
      Effect.runPromise(h.service.start(ref)),
    ]);
    expect(results[0]?.session.externalSessionId).toBe(results[1]?.session.externalSessionId);
    expect(h.starts).toHaveLength(1);
  });

  test.each([
    ["start", "fairnest"],
    ["start", "other-workspace"],
    ["restore", "fairnest"],
    ["restore", "other-workspace"],
  ] as const)(
    "a blocked %s does not block another model save in %s",
    async (operation, workspaceId) => {
      const h = setup();
      const first = await Effect.runPromise(
        h.service.create(operation === "restore" ? worktreeInput() : input()),
      );
      const firstRef = { workspaceId: "fairnest", sessionId: first.session.id };
      if (operation === "restore") {
        await Effect.runPromise(
          h.service.archive({
            ...firstRef,
            confirmStop: true,
            removeWorktree: true,
            worktreeConfirmation: {
              workingDirectory: first.session.executionTarget.workingDirectory,
              branchName: "odt/my-feature",
            },
          }),
        );
      }
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const otherDatabase =
              workspaceId === "fairnest"
                ? null
                : yield* Effect.acquireRelease(
                    Effect.tryPromise(() =>
                      createSqliteTaskStoreHarness({
                        workspaceId: "other-workspace",
                        repoPath: "/repos/Other",
                      }),
                    ),
                    (other) => Effect.promise(() => other.cleanup()),
                  );
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const service = createWorkspaceSessionService({
              ...h.dependencies,
              store: createSqliteWorkspaceSessionStore((repoPath, operation, use) => {
                const provider =
                  otherDatabase?.repoPath === repoPath
                    ? otherDatabase.contextProvider
                    : database.contextProvider;
                return provider(repoPath, operation, use);
              }),
              settings: {
                ...h.dependencies.settings,
                getRepoConfig: (id) =>
                  h.dependencies.settings.getRepoConfig(id).pipe(
                    Effect.map((config) => ({
                      ...config,
                      workspaceId: id,
                      repoPath: id === "fairnest" ? database.repoPath : "/repos/Other",
                    })),
                  ),
              },
              runtime: {
                runtimeEnsure: (request) =>
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.zipRight(Deferred.await(release)),
                    Effect.zipRight(h.dependencies.runtime.runtimeEnsure(request)),
                  ),
              },
              worktreeFiles: {
                ...h.dependencies.worktreeFiles,
                copyConfiguredPaths: (...args) =>
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.zipRight(Deferred.await(release)),
                    Effect.zipRight(h.dependencies.worktreeFiles.copyConfiguredPaths(...args)),
                  ),
              },
            });
            const second = yield* service.create({ ...input(), workspaceId });
            const pending = yield* Effect.forkScoped(
              operation === "start"
                ? service.start(firstRef).pipe(Effect.asVoid)
                : service.restore(firstRef).pipe(Effect.asVoid),
            );
            yield* Deferred.await(entered);
            const ref = { workspaceId, sessionId: second.session.id };
            const selectedModel = {
              runtimeKind: "opencode" as const,
              providerId: "provider",
              modelId: "changed-model",
            };
            const save = yield* Effect.forkScoped(service.setDraftModel({ ...ref, selectedModel }));
            yield* TestClock.adjust(0);
            expect(Option.isSome(yield* Fiber.poll(save))).toBe(true);
            expect((yield* service.get(ref)).selectedModel).toEqual(selectedModel);
            expect(Option.isNone(yield* Fiber.poll(pending))).toBe(true);
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(pending);
          }),
        ).pipe(Effect.provide(TestContext.TestContext)),
      );
    },
  );

  test.each(["start", "model", "archive"] as const)(
    "orders a same-session %s after an in-flight start",
    async (operation) => {
      const h = setup();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const service = createWorkspaceSessionService({
              ...h.dependencies,
              runtime: {
                runtimeEnsure: (request) =>
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.zipRight(Deferred.await(release)),
                    Effect.zipRight(h.dependencies.runtime.runtimeEnsure(request)),
                  ),
              },
            });
            const { session } = yield* service.create(input());
            const ref = { workspaceId: "fairnest", sessionId: session.id };
            const start = yield* Effect.forkScoped(service.start(ref));
            yield* Deferred.await(entered);
            const followup = Effect.suspend(() => {
              if (operation === "start") return service.start(ref).pipe(Effect.asVoid);
              if (operation === "archive") {
                return service
                  .archive({ ...ref, confirmStop: true, removeWorktree: false })
                  .pipe(Effect.asVoid);
              }
              return service
                .setDraftModel({
                  ...ref,
                  selectedModel: {
                    runtimeKind: "opencode",
                    providerId: "new",
                    modelId: "new",
                  },
                })
                .pipe(Effect.asVoid);
            });
            const next = yield* Effect.forkScoped(Effect.exit(followup));
            yield* TestClock.adjust(0);
            expect(Option.isNone(yield* Fiber.poll(next))).toBe(true);
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(start);
            const result = yield* Fiber.join(next);
            expect(Exit.isFailure(result)).toBe(operation === "model");
            if (Exit.isFailure(result))
              expect(Cause.pretty(result.cause)).toContain("active draft");
            const saved = yield* service.get(ref);
            expect(saved.externalSessionId).toBe("native-1");
            expect(saved.selectedModel).toEqual(session.selectedModel);
            expect(saved.archivedAt !== null).toBe(operation === "archive");
            expect(h.starts).toHaveLength(1);
          }),
        ).pipe(Effect.provide(TestContext.TestContext)),
      );
    },
  );

  test("restore waits for an in-flight archive to save its state", async () => {
    const h = setup();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const service = createWorkspaceSessionService({
            ...h.dependencies,
            store: {
              ...h.dependencies.store,
              archive: (request) =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.zipRight(Deferred.await(release)),
                  Effect.zipRight(h.dependencies.store.archive(request)),
                ),
            },
          });
          const { session } = yield* service.create(input());
          const ref = { workspaceId: "fairnest", sessionId: session.id };
          const archive = yield* Effect.acquireRelease(
            Effect.forkScoped(
              service.archive({ ...ref, confirmStop: false, removeWorktree: false }),
            ),
            () => Deferred.succeed(release, undefined),
          );
          yield* Deferred.await(entered);
          const restore = yield* Effect.forkScoped(service.restore(ref));
          yield* TestClock.adjust(0);
          expect(Option.isNone(yield* Fiber.poll(restore))).toBe(true);
          yield* Deferred.succeed(release, undefined);
          expect((yield* Fiber.join(archive)).archivedAt).not.toBeNull();
          expect((yield* Fiber.join(restore)).archivedAt).toBeNull();
          expect((yield* service.get(ref)).archivedAt).toBeNull();
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    );
  });

  test("archives a draft without runtime observation and rejects starting an archived draft", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    h.state.observation = "error";
    const archived = await Effect.runPromise(
      h.service.archive({ ...ref, confirmStop: false, removeWorktree: false }),
    );
    expect(archived.externalSessionId).toBeNull();
    expect(h.calls).toEqual(["save"]);
    await expect(Effect.runPromise(h.service.start(ref))).rejects.toThrow("Restore");
  });

  test("saves model edits only while the session is a draft", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const selectedModel = {
      runtimeKind: "opencode" as const,
      providerId: "new-provider",
      modelId: "new-model",
    };
    await Effect.runPromise(h.service.setDraftModel({ ...ref, selectedModel }));
    expect(h.starts).toEqual([]);
    await Effect.runPromise(h.service.start(ref));
    expect(h.starts[0]?.model).toEqual(selectedModel);
    await expect(
      Effect.runPromise(h.service.setDraftModel({ ...ref, selectedModel })),
    ).rejects.toThrow("active draft");
  });

  test("restore rejects an invalid directory without changing archive state", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(input()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const archived = await Effect.runPromise(
      h.service.archive({ ...ref, confirmStop: false, removeWorktree: false }),
    );
    h.state.validGit = false;
    await expect(Effect.runPromise(h.service.restore(ref))).rejects.toThrow(
      "saved canonical Git directory",
    );
    expect(await Effect.runPromise(h.service.get(ref))).toEqual(archived);
  });

  test.each(["directory", "branch", "default branch"] as const)(
    "restore refuses a conflicting or missing %s without changing the archive",
    async (conflict) => {
      const h = setup();
      const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
      const ref = { workspaceId: "fairnest", sessionId: session.id };
      const archived = await Effect.runPromise(
        h.service.archive({
          ...ref,
          confirmStop: true,
          removeWorktree: true,
          worktreeConfirmation: {
            workingDirectory: session.executionTarget.workingDirectory,
            branchName: "odt/my-feature",
          },
        }),
      );
      const directory = session.executionTarget.workingDirectory;
      h.calls.length = 0;
      if (conflict === "directory") h.paths.add(directory);
      else if (conflict === "branch") h.branches.add("refs/heads/odt/my-feature");
      else h.dependencies.git.referenceExists = () => Effect.succeed(false);
      await expect(Effect.runPromise(h.service.restore(ref))).rejects.toThrow(
        conflict === "directory"
          ? "Cannot restore into an existing worktree or directory"
          : conflict === "branch"
            ? "Cannot restore because branch odt/my-feature already exists"
            : "Configured default branch origin/main is unavailable",
      );
      expect(await Effect.runPromise(h.service.get(ref))).toEqual(archived);
      expect(h.calls).toEqual([]);
      expect(h.paths.has(directory)).toBe(conflict === "directory");
      expect(h.branches.has("refs/heads/odt/my-feature")).toBe(conflict === "branch");
    },
  );

  test("removes a dirty worktree only after stopping, and restores the same session from the default branch", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const started = await Effect.runPromise(h.service.start(ref));
    h.state.changed = true;
    h.state.observation = "running";
    expect(await Effect.runPromise(h.service.archivePreview(ref))).toEqual({
      branchName: "odt/my-feature",
      worktreeExists: true,
      hasUncommittedChanges: true,
    });
    await expect(
      Effect.runPromise(
        h.service.archive({
          ...ref,
          confirmStop: false,
          removeWorktree: true,
          worktreeConfirmation: {
            workingDirectory: session.executionTarget.workingDirectory,
            branchName: "odt/my-feature",
          },
        }),
      ),
    ).rejects.toThrow("Confirm Stop");
    expect(h.paths.size).toBe(1);
    const archived = await Effect.runPromise(
      h.service.archive({
        ...ref,
        confirmStop: true,
        removeWorktree: true,
        worktreeConfirmation: {
          workingDirectory: session.executionTarget.workingDirectory,
          branchName: "odt/my-feature",
        },
      }),
    );
    expect(archived.executionTarget).toMatchObject({
      kind: "local_worktree",
      worktreeState: "removed",
    });
    expect(h.calls.slice(-3)).toEqual(["stop", "remove-worktree", "delete-branch"]);
    expect(h.paths.size).toBe(0);
    expect(h.branches.size).toBe(0);
    const restored = await Effect.runPromise(h.service.restore(ref));
    expect(restored).toEqual(started.session);
    expect(h.state.startPoint).toBe("origin/main");
    expect(h.paths.has(session.executionTarget.workingDirectory)).toBe(true);
    expect(h.starts).toHaveLength(1);
    const callsBefore = h.calls.length;
    expect(await Effect.runPromise(h.service.restore(ref))).toEqual(restored);
    expect(h.calls).toHaveLength(callsBefore);
  });

  test.each(["failCleanup", "failDelete", "failArchive"] as const)(
    "archive can finish after %s without losing its saved branch",
    async (failure) => {
      const h = setup();
      const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
      const ref = { workspaceId: "fairnest", sessionId: session.id };
      h.state[failure] = true;
      await expect(
        Effect.runPromise(
          h.service.archive({
            ...ref,
            confirmStop: true,
            removeWorktree: true,
            worktreeConfirmation: {
              workingDirectory: session.executionTarget.workingDirectory,
              branchName: "odt/my-feature",
            },
          }),
        ),
      ).rejects.toThrow();
      expect(await Effect.runPromise(h.service.get(ref))).toEqual(session);
      h.state[failure] = false;
      const archived = await Effect.runPromise(
        h.service.archive({
          ...ref,
          confirmStop: true,
          removeWorktree: true,
          worktreeConfirmation: {
            workingDirectory: session.executionTarget.workingDirectory,
            branchName: "odt/my-feature",
          },
        }),
      );
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.executionTarget).toMatchObject({
        kind: "local_worktree",
        worktreeState: "removed",
      });
      expect(h.paths.size).toBe(0);
      expect(h.branches.size).toBe(0);
    },
  );

  test("keeps the chat archived and uncertain resources intact after Git restore failure", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const archived = await Effect.runPromise(
      h.service.archive({
        ...ref,
        confirmStop: true,
        removeWorktree: true,
        worktreeConfirmation: {
          workingDirectory: session.executionTarget.workingDirectory,
          branchName: "odt/my-feature",
        },
      }),
    );
    h.calls.length = 0;
    h.state.partialCreate = true;
    await expect(Effect.runPromise(h.service.restore(ref))).rejects.toThrow();
    expect(await Effect.runPromise(h.service.get(ref))).toEqual(archived);
    expect(h.paths.has(session.executionTarget.workingDirectory)).toBe(true);
    expect(h.registered.has(session.executionTarget.workingDirectory)).toBe(true);
    expect(h.branches.has("refs/heads/odt/my-feature")).toBe(true);
    expect(h.calls).not.toContain("remove-worktree");
    expect(h.calls).not.toContain("delete-branch");
  });

  test.each(["failHook", "failRestore"] as const)(
    "restore rolls back new Git resources after %s",
    async (failure) => {
      const h = setup();
      const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
      const ref = { workspaceId: "fairnest", sessionId: session.id };
      const archived = await Effect.runPromise(
        h.service.archive({
          ...ref,
          confirmStop: true,
          removeWorktree: true,
          worktreeConfirmation: {
            workingDirectory: session.executionTarget.workingDirectory,
            branchName: "odt/my-feature",
          },
        }),
      );
      h.state[failure] = true;
      await expect(Effect.runPromise(h.service.restore(ref))).rejects.toThrow();
      expect(await Effect.runPromise(h.service.get(ref))).toEqual(archived);
      expect(h.paths.size).toBe(0);
      expect(h.branches.size).toBe(0);
      h.state[failure] = false;
      expect((await Effect.runPromise(h.service.restore(ref))).archivedAt).toBeNull();
    },
  );

  test("rejects removal of the checkout or a worktree that changed branches", async () => {
    const h = setup();
    const root = await Effect.runPromise(h.service.create(input()));
    await expect(
      Effect.runPromise(
        h.service.archive({
          workspaceId: "fairnest",
          sessionId: root.session.id,
          confirmStop: true,
          removeWorktree: true,
        }),
      ),
    ).rejects.toThrow("repository checkout");
    const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    h.state.branch = "different";
    await expect(
      Effect.runPromise(
        h.service.archive({
          ...ref,
          confirmStop: true,
          removeWorktree: true,
          worktreeConfirmation: {
            workingDirectory: session.executionTarget.workingDirectory,
            branchName: "odt/my-feature",
          },
        }),
      ),
    ).rejects.toThrow("branch changed");
    expect(h.calls).not.toContain("remove-worktree");
    const archived = await Effect.runPromise(
      h.service.archive({ ...ref, confirmStop: true, removeWorktree: false }),
    );
    expect(archived.executionTarget).toEqual(session.executionTarget);
    expect(h.paths.size).toBe(1);
  });

  test("reports restore and rollback failures without unarchiving the chat", async () => {
    const h = setup();
    const { session } = await Effect.runPromise(h.service.create(worktreeInput()));
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const archived = await Effect.runPromise(
      h.service.archive({
        ...ref,
        confirmStop: true,
        removeWorktree: true,
        worktreeConfirmation: {
          workingDirectory: session.executionTarget.workingDirectory,
          branchName: "odt/my-feature",
        },
      }),
    );
    h.state.failHook = true;
    h.state.failCleanup = true;
    await expect(Effect.runPromise(h.service.restore(ref))).rejects.toThrow(
      /hook failed[\s\S]*worktree removal failed/,
    );
    expect(await Effect.runPromise(h.service.get(ref))).toEqual(archived);
  });
});
