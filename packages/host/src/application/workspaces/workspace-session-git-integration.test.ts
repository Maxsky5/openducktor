import {
  workspaceSessionCatalog,
  workspaceSessionOwnership,
} from "../../test-support/workspace-session-ownership";
import { gitFixtureCommand, gitFixtureEnv } from "../../test-support/git-repository-fixture";
import { HostOperationError } from "../../effect/host-errors";
import { WorktreeActionExitError } from "../actions/worktree-action-runner";
import { createWorkspaceSessionImportService } from "./workspace-session-import-service";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import {
  createAgentSessionRuntimeAdapterTestDouble,
  createClaudeSessionMetadataTestDouble,
} from "../../test-support/service-test-doubles";
import { removeWorkspaceSessionWorktree } from "./workspace-session-worktree-lifecycle";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  repoConfigSchema,
  type AgentSessionControlStartInput,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { Cause, Deferred, Effect, Exit } from "effect";
import { z } from "zod";
import { createWorktreeFileAdapter } from "../../adapters/filesystem/worktree-file-adapter";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { createSqliteSharedSettingsDatabase } from "../../adapters/sqlite/sqlite-shared-settings-database";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { createWorkspaceSessionCommandHandlers } from "../../interface/commands/workspace-session-command-handlers";
import { hostInvokeFailureFromError } from "../../interface/router/host-invoke-failure";
import {
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../../interface/router/host-command-router";
import {
  createWorkspaceSessionService,
  type WorkspaceSessionServiceDependencies,
} from "./workspace-session-service";
import { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import type {
  WorktreeActionRunInput,
  WorktreeActionRunner,
} from "../actions/worktree-action-runner";

const commitIdentity = [
  "-c",
  "user.name=Workspace Test",
  "-c",
  "user.email=test@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

const runGit = (cwd: string, ...args: string[]) =>
  execFileSync(gitFixtureCommand, args, {
    cwd,
    encoding: "utf8",
    env: gitFixtureEnv,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const missingPathErrorSchema = z.object({ code: z.literal("ENOENT") });

describe("Workspace Session commands with real Git and SQLite", () => {
  let fixtureRoot: string;
  let fixtureRepoPath: string;
  let initialHead: string;
  let fixtureHead: string;
  let root: string;
  let repoPath: string;
  let database: SqliteTaskStoreTestHarness;
  const gitCommand = (...args: string[]) => runGit(repoPath, ...args);
  const registeredWorktreePaths = () =>
    runGit(repoPath, "worktree", "list", "--porcelain", "-z")
      .split("\0")
      .filter((field) => field.startsWith("worktree "))
      .map((field) => path.resolve(field.slice("worktree ".length)));
  // Git initialization and two commits spawn several processes on Windows.
  beforeAll(async () => {
    fixtureRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "odt-workspace-session-git-fixture-")),
    );
    fixtureRepoPath = path.join(fixtureRoot, "repository");
    await mkdir(fixtureRepoPath);
    runGit(fixtureRepoPath, "init", "--template=", "-b", "main");
    runGit(fixtureRepoPath, "config", "core.autocrlf", "false");
    runGit(fixtureRepoPath, "config", "core.eol", "lf");
    await writeFile(path.join(fixtureRepoPath, "tracked.txt"), "committed\n");
    await writeFile(path.join(fixtureRepoPath, ".gitignore"), ".env\n");
    runGit(fixtureRepoPath, "add", ".");
    runGit(fixtureRepoPath, ...commitIdentity, "commit", "-m", "Initial fixture");
    runGit(fixtureRepoPath, ...commitIdentity, "commit", "--allow-empty", "-m", "Current checkout");
    // SAFETY: rev-parse prints two full 40-character hashes in the requested order.
    [fixtureHead, initialHead] = runGit(fixtureRepoPath, "rev-parse", "HEAD", "HEAD~1").split(
      "\n",
    ) as [string, string];
  }, 10_000);
  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "odt-workspace-session-git-")));
    repoPath = path.join(root, "repository");
    await cp(fixtureRepoPath, repoPath, { recursive: true });
    database = await createSqliteTaskStoreHarness({ repoPath });
  });
  afterEach(async () => {
    await database.cleanup();
    // Windows keeps a junction locked during a recursive delete. Remove the link first.
    const aliasPath = path.join(root, "native-alias");
    try {
      if ((await lstat(aliasPath)).isSymbolicLink()) await unlink(aliasPath);
    } catch (error) {
      if (!missingPathErrorSchema.safeParse(error).success) throw error;
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const setup = ({ actions = true } = {}) => {
    const starts: AgentSessionControlStartInput[] = [];
    const events: WorkspaceSession[] = [];
    // Each run records the copied `.env` that the worktree held when its actions started.
    const actionRuns: Array<WorktreeActionRunInput & { worktreePath: string; env: string | null }> =
      [];
    const config = repoConfigSchema.parse({
      workspaceId: "fairnest",
      workspaceName: "Test",
      repoPath,
      defaultTargetBranch: { remote: null, branch: "main" },
      branchPrefix: "odt",
      worktreeBasePath: path.join(root, "worktrees"),
      worktreeCopyPaths: [".env"],
      hooks: { beforeWorktreeRemoval: [] },
      actions: actions
        ? {
            items: [
              {
                id: "install",
                icon: "build",
                name: "Install",
                command: "bun install",
                runOnWorktreeCreate: true,
                waitBeforeAgentStart: true,
              },
            ],
            defaultActionId: "install",
          }
        : { items: [], defaultActionId: null },
    });
    const worktreeActions: WorktreeActionRunner = {
      createRun: ({ worktreePath }) => ({
        run: (input) =>
          Effect.promise(async () => {
            const env = await readFile(path.join(worktreePath, ".env"), "utf8").catch(() => null);
            actionRuns.push({ ...input, worktreePath, env });
          }),
        stopTerminals: () => Effect.void,
      }),
    };
    const targetDependencies = {
      git: createGitCliAdapter({
        resolveCommand: () => Effect.succeed(gitFixtureCommand),
        readEnv: () => gitFixtureEnv,
      }),
      settingsConfig: createSettingsConfigAdapter({
        configPath: path.join(root, "settings.json"),
        sharedSettings: createSqliteSharedSettingsDatabase(database),
      }),
      worktreeFiles: createWorktreeFileAdapter(),
      worktreeActions,
    };
    const store = createSqliteWorkspaceSessionStore(database);
    const dependencies: WorkspaceSessionServiceDependencies = {
      chatNaming: { registerCreated: () => undefined },
      taskOwnership: database.taskOwnership,
      claudeSessionMetadata: createClaudeSessionMetadataTestDouble(),
      runtimeAdmission: { admit: (_kind, work) => work },
      runForkSourceOperation: (_target, work) => work,
      browserTabs: { closeOwnerTabs: () => Effect.void },
      terminalService: {
        acquireWorkspaceSessionCleanup: () => Effect.succeed({ closedTerminalIds: [] }),
      },
      lifecycle: createTaskSessionLifecycleCoordinator(),
      operationGate: createWorkspaceSessionOperationGate(),
      sessionTitleGate: createWorkspaceSessionOperationGate(),
      isTitleSyncPending: () => false,
      markTitleSyncPending: () => {},
      ...targetDependencies,
      store,
      settings: {
        getRepoConfig: () => Effect.succeed(config),
        getWorkspaceCatalog: () => Effect.succeed(workspaceSessionCatalog(config)),
        listCustomAgentRoles: () => Effect.succeed([]),
      },
      runtime: {
        requireReady: () =>
          Effect.succeed({
            kind: "opencode",
            runtimeId: "test-runtime",
            runtimeRoute: { type: "local_http", endpoint: "http://localhost:1234" },
            startedAt: "2026-09-07T00:00:00Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          }),
      },
      live: {
        forkSession: () => Effect.die(new Error("unexpected fork")),
        resumeSession: (request) =>
          Effect.succeed({
            externalSessionId: request.externalSessionId,
            runtimeKind: request.runtimeKind,
            workingDirectory: request.workingDirectory,
            startedAt: "2026-09-07T00:00:00Z",
            status: "idle" as const,
          }),
        startSession: (input) =>
          Effect.suspend(() => {
            starts.push(input);
            return Effect.succeed({
              externalSessionId: "native-1",
              runtimeKind: input.runtimeKind,
              workingDirectory: input.workingDirectory,
              startedAt: "2026-09-07T00:00:00Z",
              status: "idle",
            });
          }),
        releaseSession: () => Effect.void,
        stopSession: () => Effect.die(new Error("Idle sessions must not be stopped")),
        updateSessionTitle: () => Effect.die(new Error("Unexpected live session title update")),
        read: (ref) => Effect.succeed({ type: "missing", ref }),
      },
    };
    const service = createWorkspaceSessionService(dependencies);
    const router = toPromiseHostCommandRouter(
      createEffectHostCommandRouter({
        handlers: createWorkspaceSessionCommandHandlers(service, (_workspaceId, session) =>
          Effect.sync(() => {
            events.push(session);
          }),
        ),
      }),
    );
    const createInput = {
      workspaceId: "fairnest",
      runtimeKind: "opencode",
      selectedModel: { runtimeKind: "opencode", providerId: "provider", modelId: "model" },
      customAgentRoleId: null,
      location: "local_worktree",
      worktree: { mode: "from_name", name: "named-chat", branchName: null },
      manualTitle: null,
      targetBranch: { branch: "main" },
    };
    return {
      router,
      createInput,
      starts,
      events,
      targetDependencies,
      dependencies,
      actionRuns,
      config,
    };
  };

  // This case creates two real worktrees and commits in the source checkout.
  test("forks a worktree at the source committed HEAD with configured setup", async () => {
    await writeFile(path.join(repoPath, ".env"), "ROOT_ENV=1\n");
    const h = setup();
    gitCommand("branch", "release", "main~1");
    const targetBranch = { branch: "release" };
    const draft = await h.router.invoke("workspace_session_create", {
      ...h.createInput,
      targetBranch,
    });
    await h.router.invoke("workspace_session_start", {
      workspaceId: "fairnest",
      sessionId: draft.session.id,
    });
    const source = draft.session.executionTarget.workingDirectory;
    await writeFile(path.join(source, "tracked.txt"), "source commit\n");
    runGit(source, ...commitIdentity, "commit", "-am", "Source checkout change");
    const sourceHead = runGit(source, "rev-parse", "HEAD");
    await writeFile(path.join(source, "tracked.txt"), "uncommitted source change\n");
    await writeFile(path.join(source, ".env"), "SOURCE_ENV=1\n");
    const service = createWorkspaceSessionService({
      ...h.dependencies,
      live: {
        ...h.dependencies.live,
        forkSession: (request) =>
          Effect.gen(function* () {
            expect(request.sourceWorkingDirectory).toBe(source);
            const destination = yield* h.dependencies.git.canonicalizePath(
              request.workingDirectory,
            );
            // Runtime directory reads use a separate fiber at the native Promise boundary.
            yield* Effect.promise(() =>
              Effect.runPromise(h.dependencies.lifecycle.runWorktreeRead(destination, Effect.void)),
            );
            return {
              externalSessionId: "fork-native",
              runtimeKind: request.runtimeKind,
              workingDirectory: destination,
              startedAt: "2026-10-22T12:00:00Z",
              status: "idle" as const,
            };
          }),
      },
    });
    const fork = await Effect.runPromise(
      service.fork({
        workspaceId: "fairnest",
        sessionId: draft.session.id,
        forkPoint: { messageId: "completed-reply" },
        destination: { kind: "new_worktree", name: "forked-chat", branchName: "odt/forked-chat" },
      }),
    );
    const destination = fork.record.executionTarget.workingDirectory;
    expect(fork.record.targetBranch).toEqual(targetBranch);
    expect(runGit(destination, "rev-parse", "HEAD")).toBe(sourceHead);
    expect(runGit(repoPath, "rev-parse", "HEAD")).toBe(fixtureHead);
    expect(await readFile(path.join(destination, "tracked.txt"), "utf8")).toBe("source commit\n");
    expect(await readFile(path.join(source, "tracked.txt"), "utf8")).toBe(
      "uncommitted source change\n",
    );
    expect(h.actionRuns.at(-1)).toMatchObject({
      worktreePath: destination,
      env: "ROOT_ENV=1\n",
      context: { kind: "workspace_session", sessionId: fork.record.id },
    });
    expect(
      (
        await Effect.runPromise(
          service.get({ workspaceId: "fairnest", sessionId: draft.session.id }),
        )
      ).executionTarget,
    ).toEqual(draft.session.executionTarget);
  }, 10_000);

  // This case copies a real repository and creates a worktree with Git on Windows.
  test("creates from_branch at the selected branch HEAD instead of the source checkout HEAD", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    const h = setup({ actions: false });
    gitCommand("branch", "feature/existing", "main~1");
    const { session } = await h.router.invoke("workspace_session_create", {
      ...h.createInput,
      worktree: { mode: "from_branch", name: "existing-review", branchName: "feature/existing" },
    });
    const directory = session.executionTarget.workingDirectory;
    expect(
      gitCommand("-C", directory, "rev-parse", "HEAD", "--symbolic-full-name", "HEAD").split("\n"),
    ).toEqual([initialHead, "refs/heads/feature/existing"]);
    expect(initialHead).not.toBe(fixtureHead);
    expect(session.executionTarget).toMatchObject({
      kind: "local_worktree",
      branchName: "feature/existing",
      worktreeState: "present",
    });
    expect(directory).toBe(path.join(root, "worktrees", "workspace-sessions", "existing-review"));
    expect(h.starts).toEqual([]);
  }, 10_000);

  const existingWorktreeInput = (h: ReturnType<typeof setup>, workingDirectory: string) => {
    const { worktree: _worktree, ...fields } = h.createInput;
    return {
      ...fields,
      location: "existing_worktree",
      existingWorktree: { workingDirectory },
    };
  };

  // Each case adds real worktrees with several Git processes.
  test("lists worktrees and preserves a shared checkout through chat creation and archive", async () => {
    const h = setup();
    const external = path.join(root, "external");
    const detached = path.join(root, "detached");
    const gone = path.join(root, "gone");
    gitCommand("worktree", "add", "-b", "external", external, "main");
    gitCommand("worktree", "add", "--detach", detached, "main");
    gitCommand("worktree", "add", "-b", "gone", gone, "main");
    await rm(gone, { recursive: true, force: true });

    expect(
      await h.router.invoke("workspace_session_worktrees_list", { workspaceId: "fairnest" }),
    ).toEqual({
      worktrees: [
        { workingDirectory: detached, branchName: null },
        { workingDirectory: external, branchName: "external" },
      ],
    });

    await writeFile(path.join(external, "tracked.txt"), "local change\n");
    await writeFile(path.join(external, "notes.txt"), "untracked\n");
    // A branch change after selection is valid. The chat saves the branch present at creation.
    runGit(external, "switch", "-c", "renamed");
    const before = registeredWorktreePaths();
    const input = existingWorktreeInput(h, external);
    const first = await h.router.invoke("workspace_session_create", input);
    const second = await h.router.invoke("workspace_session_create", input);

    for (const created of [first, second])
      expect(created.session.executionTarget).toEqual({
        kind: "local_worktree",
        workingDirectory: external,
        branchName: "renamed",
        worktreeState: "present",
      });
    expect(first.session.id).not.toBe(second.session.id);
    expect(first.session.externalSessionId).toBeNull();
    const ref = { workspaceId: "fairnest", sessionId: first.session.id };

    expect(await h.router.invoke("workspace_session_archive_preview", ref)).toMatchObject({
      branchName: "renamed",
      sharedWith: [{ workspaceId: "fairnest", sessionId: second.session.id }],
      taskOwners: [],
    });
    await expect(
      h.router.invoke("workspace_session_archive", {
        ...ref,
        removeWorktree: true,
        worktreeConfirmation: { workingDirectory: external, branchName: "renamed" },
      }),
    ).rejects.toThrow("Saved sessions work in a removed worktree");
    const archived = await h.router.invoke("workspace_session_archive", ref);

    expect(archived.archivedAt).not.toBeNull();
    expect(archived.executionTarget).toEqual(first.session.executionTarget);
    expect(registeredWorktreePaths()).toEqual(before);
    expect(runGit(external, "branch", "--show-current")).toBe("renamed");
    expect(await readFile(path.join(external, "tracked.txt"), "utf8")).toBe("local change\n");
    expect(await readFile(path.join(external, "notes.txt"), "utf8")).toBe("untracked\n");
    expect(h.actionRuns).toEqual([]);
    expect(gitCommand("branch", "--list", "odt/*")).toBe("");
  }, 15_000);

  test("rejects a stale existing worktree choice and keeps the directory", async () => {
    const h = setup();
    const other = path.join(root, "other-repository");
    await mkdir(other);
    runGit(other, "init", "-b", "main");
    const create = (workingDirectory: string) =>
      Effect.runPromise(
        Effect.flip(
          Effect.tryPromise({
            try: () =>
              h.router.invoke(
                "workspace_session_create",
                existingWorktreeInput(h, workingDirectory),
              ),
            catch: (cause) => cause,
          }),
        ),
      );

    expect(String(await create(path.join(root, "missing")))).toContain(
      "Worktree directory is missing",
    );
    expect(String(await create(other))).toContain(
      "is not a registered worktree of this repository",
    );
    expect(String(await create(repoPath))).toContain("is the current checkout");
    expect(runGit(other, "rev-parse", "--is-inside-work-tree")).toBe("true");
    expect(
      await h.router.invoke("workspace_session_list_active", { workspaceId: "fairnest" }),
    ).toEqual([]);
  }, 15_000);

  test("an existing worktree chat waits for setup at that path and reports its rollback", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    const h = setup();
    const entered = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    h.targetDependencies.worktreeActions.createRun = () => ({
      run: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return yield* new WorktreeActionExitError({
            actionName: "Install",
            outputTail: [],
            message: "Install failed.",
            exitCode: 1,
            signal: null,
          });
        }),
      stopTerminals: () => Effect.void,
    });
    const settingUp = Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => h.router.invoke("workspace_session_create", h.createInput),
        catch: (cause) => cause,
      }),
    );
    await Effect.runPromise(Deferred.await(entered));
    const directory = path.join(root, "worktrees", "workspace-sessions", "named-chat");
    expect(registeredWorktreePaths()).toContain(directory);
    // The existing worktree chat resolves its guard path just before it waits for the setup.
    const guarding = Effect.runSync(Deferred.make<void>());
    const { worktreeFiles } = h.targetDependencies;
    const resolveRemovalPath = worktreeFiles.resolveWorktreeRemovalPath;
    worktreeFiles.resolveWorktreeRemovalPath = (value) =>
      resolveRemovalPath(value).pipe(Effect.tap(() => Deferred.succeed(guarding, undefined)));
    const adopting = Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => h.router.invoke("workspace_session_create", existingWorktreeInput(h, directory)),
        catch: (cause) => cause,
      }),
    );
    await Effect.runPromise(Deferred.await(guarding));
    await Effect.runPromise(Deferred.succeed(release, undefined));

    const failedSetup = await settingUp;
    expect(Exit.isFailure(failedSetup)).toBe(true);
    if (Exit.isFailure(failedSetup))
      expect(Cause.pretty(failedSetup.cause)).toContain("Install failed.");
    const failedAdoption = await adopting;
    expect(Exit.isFailure(failedAdoption)).toBe(true);
    if (Exit.isFailure(failedAdoption))
      expect(Cause.pretty(failedAdoption.cause)).toContain("Worktree directory is missing");
    expect(registeredWorktreePaths()).not.toContain(directory);
    expect(
      await h.router.invoke("workspace_session_list_active", { workspaceId: "fairnest" }),
    ).toEqual([]);
  }, 15_000);

  // Competing requests run two real Git worktree operations and SQLite writes on Windows.
  test("a failed create leaves a competing chat's real worktree and files intact", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    const h = setup({ actions: false });
    const entered = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const createWorktree = h.targetDependencies.git.createWorktree;
    let first = true;
    h.targetDependencies.git.createWorktree = (...args) =>
      Effect.gen(function* () {
        if (first) {
          first = false;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }
        yield* createWorktree(...args);
      });
    const loser = Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => h.router.invoke("workspace_session_create", h.createInput).then(() => undefined),
        catch: (cause) => cause,
      }),
    );
    try {
      await Effect.runPromise(Deferred.await(entered));
      const winner = await h.router.invoke("workspace_session_create", h.createInput);
      const directory = winner.session.executionTarget.workingDirectory;
      expect(winner.session.executionTarget).toMatchObject({
        kind: "local_worktree",
        branchName: "odt/named-chat",
      });
      await writeFile(path.join(directory, "owned.txt"), "Keep the winning request's file.");
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const failed = await loser;
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed))
        expect(Cause.pretty(failed.cause)).toContain("Git did not confirm worktree creation");
      expect(await readFile(path.join(directory, "owned.txt"), "utf8")).toBe(
        "Keep the winning request's file.",
      );
      expect(registeredWorktreePaths()).toContain(directory);
      expect(runGit(directory, "symbolic-ref", "HEAD")).toBe("refs/heads/odt/named-chat");
      expect(
        await h.router.invoke("workspace_session_list_active", { workspaceId: "fairnest" }),
      ).toEqual([winner.session]);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await loser;
    }
  }, 15_000);

  test("a new chat waits for a restore of the same directory and then leaves it intact", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    const h = setup({ actions: false });
    const archived = await Effect.runPromise(
      createSqliteWorkspaceSessionStore(database).create({
        workspaceId: "fairnest",
        repoPath,
        session: {
          id: crypto.randomUUID(),
          runtimeKind: "opencode",
          externalSessionId: null,
          executionTarget: {
            kind: "local_worktree",
            workingDirectory: path.join(root, "worktrees", "workspace-sessions", "named-chat"),
            branchName: "odt/named-chat",
            worktreeState: "removed",
          },
          roleSnapshot: null,
          selectedModel: null,
          generatedTitle: null,
          manualTitle: null,
          targetBranch: null,
          createdAt: 1,
          updatedAt: 2,
          archivedAt: 2,
        },
      }),
    );
    const ref = { workspaceId: "fairnest", sessionId: archived.id };
    const entered = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const createWorktree = h.targetDependencies.git.createWorktree;
    let first = true;
    h.targetDependencies.git.createWorktree = (...args) =>
      Effect.gen(function* () {
        if (first) {
          first = false;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }
        yield* createWorktree(...args);
      });
    const restore = h.router.invoke("workspace_session_restore", ref);
    await Effect.runPromise(Deferred.await(entered));
    // The new chat resolves its guard path just before it waits for the restore guard.
    const guarding = Effect.runSync(Deferred.make<void>());
    const { worktreeFiles } = h.targetDependencies;
    const resolveRemovalPath = worktreeFiles.resolveWorktreeRemovalPath;
    worktreeFiles.resolveWorktreeRemovalPath = (value) =>
      resolveRemovalPath(value).pipe(Effect.tap(() => Deferred.succeed(guarding, undefined)));
    const competing = Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => h.router.invoke("workspace_session_create", h.createInput),
        catch: (cause) => cause,
      }),
    );
    await Effect.runPromise(Deferred.await(guarding));
    await Effect.runPromise(Deferred.succeed(release, undefined));
    const restored = await restore;
    const directory = restored.executionTarget.workingDirectory;
    await writeFile(path.join(directory, "owned.txt"), "Keep the restored chat's file.");
    const failed = await competing;
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed))
      expect(Cause.pretty(failed.cause)).toContain("Worktree directory already exists");
    expect(await readFile(path.join(directory, "owned.txt"), "utf8")).toBe(
      "Keep the restored chat's file.",
    );
    expect(registeredWorktreePaths()).toContain(directory);
    expect(gitCommand("branch", "--list", "odt/named-chat")).toContain("odt/named-chat");
    expect(restored.archivedAt).toBeNull();
    expect(
      await h.router.invoke("workspace_session_list_active", { workspaceId: "fairnest" }),
    ).toEqual([restored]);
  }, 15_000);

  // Real Git worktree commands and SQLite writes can exceed the host suite limit on Windows.
  test("creates a named worktree from the selected branch and preserves the dirty checkout", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    await writeFile(path.join(repoPath, "tracked.txt"), "uncommitted\n");
    await writeFile(path.join(repoPath, "staged.txt"), "staged\n");
    gitCommand("add", "staged.txt");
    await writeFile(path.join(repoPath, "untracked.txt"), "untracked\n");
    const sourceStatus = gitCommand("status", "--porcelain");
    const h = setup();
    gitCommand("branch", "release", initialHead);
    // A tag with the same name points to a different commit.
    gitCommand("tag", "release", fixtureHead);
    const targetBranch = { branch: "release" };
    const branchName = "feature/archive-review";
    const { session } = await h.router.invoke("workspace_session_create", {
      ...h.createInput,
      targetBranch,
      worktree: { mode: "from_name", name: "different-directory-name", branchName },
    });
    const directory = session.executionTarget.workingDirectory;
    expect(session.targetBranch).toEqual(targetBranch);
    expect(await readFile(path.join(directory, "tracked.txt"), "utf8")).toBe("committed\n");
    expect(await readFile(path.join(repoPath, "tracked.txt"), "utf8")).toBe("uncommitted\n");
    expect(gitCommand("status", "--porcelain")).toBe(sourceStatus);
    for (const file of ["staged.txt", "untracked.txt"]) {
      await expect(readFile(path.join(directory, file), "utf8")).rejects.toThrow("ENOENT");
    }
    expect(await readFile(path.join(directory, ".env"), "utf8")).toBe("TEST_VALUE=local\n");
    expect(h.actionRuns).toEqual([
      {
        context: {
          kind: "workspace_session",
          workspaceId: "fairnest",
          sessionId: session.id,
          repoPath: await realpath(repoPath),
        },
        worktreePath: directory,
        actions: h.config.actions,
        env: "TEST_VALUE=local\n",
      },
    ]);
    expect(
      gitCommand("-C", directory, "rev-parse", "HEAD", "--symbolic-full-name", "HEAD").split("\n"),
    ).toEqual([initialHead, `refs/heads/${branchName}`]);
    expect(directory).toBe(await realpath(directory));
    expect(directory).toBe(
      path.join(root, "worktrees", "workspace-sessions", "different-directory-name"),
    );
    expect(h.starts).toEqual([]);
  }, 15_000);

  const saveWorktreeSession = (
    executionTarget: Extract<WorkspaceSession["executionTarget"], { kind: "local_worktree" }>,
    externalSessionId: string | null = null,
  ) =>
    Effect.runPromise(
      createSqliteWorkspaceSessionStore(database).create({
        ...database.scope,
        ...(externalSessionId !== null && {
          ownershipScope: workspaceSessionOwnership(database.scope),
        }),
        session: {
          id: crypto.randomUUID(),
          runtimeKind: "opencode",
          externalSessionId,
          executionTarget,
          roleSnapshot: null,
          selectedModel: null,
          generatedTitle: null,
          manualTitle: null,
          targetBranch: null,
          createdAt: 1,
          updatedAt: 2,
          archivedAt: executionTarget.worktreeState === "removed" ? 2 : null,
        },
      }),
    );

  // The archive and restore use real Git worktrees, commits, and SQLite on Windows.
  test("archives a named worktree and restores it from the advanced default branch", async () => {
    const h = setup();
    const branchName = "feature/archive-review";
    const directory = path.join(root, "worktrees", "workspace-sessions", "archive-review");
    gitCommand("worktree", "add", "-b", branchName, directory);
    gitCommand(
      "-C",
      directory,
      ...commitIdentity,
      "commit",
      "--allow-empty",
      "-m",
      "Branch-only commit",
    );
    await writeFile(path.join(directory, "tracked.txt"), "discard this edit\n");
    await writeFile(path.join(directory, "untracked.txt"), "discard this file\n");
    const session = await saveWorktreeSession({
      kind: "local_worktree",
      workingDirectory: directory,
      branchName,
      worktreeState: "present",
    });
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const archived = await h.router.invoke("workspace_session_archive", {
      ...ref,
      confirmStop: true,
      removeWorktree: true,
      worktreeConfirmation: { workingDirectory: directory, branchName },
    });
    expect(archived.executionTarget).toMatchObject({
      kind: "local_worktree",
      branchName,
      worktreeState: "removed",
    });
    expect(registeredWorktreePaths()).not.toContain(directory);
    expect(gitCommand("branch", "--list", branchName)).toBe("");
    await expect(readFile(path.join(directory, "tracked.txt"), "utf8")).rejects.toThrow();
    expect(
      await h.router.invoke("workspace_session_list_archived", { workspaceId: "fairnest" }),
    ).toEqual([archived]);
    expect(
      await h.router.invoke("workspace_session_ids_list", {
        workspaceId: "fairnest",
      }),
    ).toEqual([archived.id]);
    await expect(h.router.invoke("workspace_session_ids_list", {})).rejects.toThrow("workspaceId");

    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    const sibling = await Effect.runPromise(
      createSqliteWorkspaceSessionStore(database).create({
        workspaceId: "fairnest",
        repoPath,
        session: { ...archived, id: crypto.randomUUID() },
      }),
    );
    await writeFile(path.join(repoPath, "tracked.txt"), "new default branch content\n");
    gitCommand(...commitIdentity, "commit", "-a", "-m", "Advance default branch");
    const defaultHead = gitCommand("rev-parse", "main");
    expect(defaultHead).not.toBe(fixtureHead);
    gitCommand("checkout", "-b", "other-checkout", "main~1");
    const restored = await h.router.invoke("workspace_session_restore", ref);
    expect(restored.executionTarget).toMatchObject({
      kind: "local_worktree",
      branchName,
      worktreeState: "present",
    });
    expect(restored.archivedAt).toBeNull();
    expect(
      gitCommand("-C", directory, "rev-parse", "HEAD", "--symbolic-full-name", "HEAD").split("\n"),
    ).toEqual([defaultHead, `refs/heads/${branchName}`]);
    expect(await readFile(path.join(directory, "tracked.txt"), "utf8")).toBe(
      "new default branch content\n",
    );
    expect(await readFile(path.join(directory, ".env"), "utf8")).toBe("TEST_VALUE=local\n");
    expect(h.actionRuns).toEqual([
      {
        context: {
          kind: "workspace_session",
          workspaceId: "fairnest",
          sessionId: archived.id,
          repoPath: await realpath(repoPath),
        },
        worktreePath: directory,
        actions: h.config.actions,
        env: "TEST_VALUE=local\n",
      },
    ]);
    await expect(readFile(path.join(directory, "untracked.txt"), "utf8")).rejects.toThrow();
    await writeFile(path.join(directory, "tracked.txt"), "Keep the restored chat's edit.\n");
    gitCommand("-C", directory, "checkout", "-b", "feature/current-chat");
    await writeFile(path.join(repoPath, ".env"), "CHANGED_SOURCE=1\n");
    const restoredSibling = await h.router.invoke("workspace_session_restore", {
      workspaceId: "fairnest",
      sessionId: sibling.id,
    });
    expect(restoredSibling.archivedAt).toBeNull();
    expect(restoredSibling.executionTarget).toEqual(restored.executionTarget);
    expect(await readFile(path.join(directory, "tracked.txt"), "utf8")).toBe(
      "Keep the restored chat's edit.\n",
    );
    expect(await readFile(path.join(directory, ".env"), "utf8")).toBe("TEST_VALUE=local\n");
    expect(h.actionRuns).toHaveLength(1);
    expect(gitCommand("-C", directory, "rev-parse", "HEAD")).toBe(defaultHead);
    expect(gitCommand("-C", directory, "branch", "--show-current")).toBe("feature/current-chat");
  }, 15_000);

  // The repository fixture and the restore use real Git and SQLite on Windows.
  test.each(["unrelated repository", "plain directory"] as const)(
    "restore keeps a replacement %s and its archived record unchanged",
    async (replacement) => {
      const h = setup({ actions: false });
      const directory = path.join(root, "replacement-checkout");
      const archived = await saveWorktreeSession({
        kind: "local_worktree",
        workingDirectory: directory,
        branchName: "odt/named-chat",
        worktreeState: "removed",
      });
      const ref = { workspaceId: "fairnest", sessionId: archived.id };
      await mkdir(directory);
      if (replacement === "unrelated repository") runGit(directory, "init", "-b", "main");
      const retainedFile = path.join(directory, "retained.txt");
      await writeFile(retainedFile, "Keep this replacement checkout.\n");
      const actionCount = h.actionRuns.length;

      await expect(h.router.invoke("workspace_session_restore", ref)).rejects.toThrow(
        replacement === "plain directory" ? "is not a Git checkout" : "not a registered worktree",
      );

      expect(await h.router.invoke("workspace_session_get", ref)).toEqual(archived);
      expect(await readFile(retainedFile, "utf8")).toBe("Keep this replacement checkout.\n");
      expect(h.actionRuns).toHaveLength(actionCount);
    },
    15_000,
  );

  // Real Git worktree commands and SQLite writes can exceed the host suite limit on Windows.
  test("reports a linked checkout on its branch field and leaves both worktrees untouched", async () => {
    const h = setup();
    const occupied = path.join(
      root,
      process.platform === "win32" ? "other checkout" : "other | checkout\nwith newline ",
    );
    const occupiedGitPath = occupied.split(path.sep).join("/");
    gitCommand("worktree", "add", "-b", "feature/occupied", occupied);
    await writeFile(path.join(occupied, "owned.txt"), "keep this");
    expect(await Effect.runPromise(h.targetDependencies.git.listBranches(repoPath))).toContainEqual(
      {
        name: "feature/occupied",
        isCurrent: false,
        isRemote: false,
        worktreePath: occupiedGitPath,
      },
    );
    const error = await h.router
      .invoke("workspace_session_create", {
        ...h.createInput,
        worktree: { mode: "from_branch", name: "different-name", branchName: "feature/occupied" },
      })
      .then(
        () => {
          throw new Error("Expected branch conflict");
        },
        (cause: unknown) => cause,
      );
    expect(hostInvokeFailureFromError(error)).toEqual({
      kind: "workspace_session_validation",
      field: "worktree.branchName",
    });
    expect(error).toMatchObject({
      message: `Branch feature/occupied is already checked out at ${occupiedGitPath}. Choose another branch or use Current checkout.`,
    });
    expect(await readFile(path.join(occupied, "owned.txt"), "utf8")).toBe("keep this");
    expect(gitCommand("branch", "--show-current")).toBe("main");
    expect(
      await h.router.invoke("workspace_session_list_active", { workspaceId: "fairnest" }),
    ).toEqual([]);
    expect(h.events).toEqual([]);
  }, 15_000);

  const externalAliasId = "external-alias";

  const importNativeAlias = async (h: ReturnType<typeof setup>, alias: string) => {
    const registry = createLiveSessionAdapterRegistry();
    const metadata = {
      externalSessionId: externalAliasId,
      runtimeKind: "opencode" as const,
      workingDirectory: alias,
      title: "Native alias",
      updatedAt: 123,
    };
    await Effect.runPromise(
      registry.register(
        createAgentSessionRuntimeAdapterTestDouble(
          { runtimeId: "test-runtime", runtimeKind: "opencode" },
          {
            sessionImport: {
              scanSessions: () => {
                let read = false;
                return {
                  next: () =>
                    Effect.sync(() => {
                      if (read) return { done: true as const, value: undefined };
                      read = true;
                      return { done: false as const, value: [metadata] };
                    }),
                };
              },
              inspectSession: (ref) => {
                expect(ref.workingDirectory).toBe(alias);
                return Effect.succeed({
                  metadata,
                  selectedModel: null,
                  attach: Effect.void,
                });
              },
            },
          },
        ),
      ),
    );
    const importer = createWorkspaceSessionImportService({
      ...h.dependencies,
      registry,
      publishUpdated: () => Effect.void,
    });
    try {
      const catalogRequestId = crypto.randomUUID();
      await Effect.runPromise(
        importer.list({
          workspaceId: "fairnest",
          catalogRequestId,
          runtimeKind: "opencode",
          search: "",
          pageSize: 50,
        }),
      );
      const { session } = await Effect.runPromise(
        importer.importSession({
          workspaceId: "fairnest",
          catalogRequestId,
          runtimeKind: "opencode",
          externalSessionId: metadata.externalSessionId,
          workingDirectory: alias,
        }),
      );
      return session;
    } finally {
      await Effect.runPromise(importer.shutdown());
    }
  };

  // Each case uses real Git worktrees and SQLite across archive or restore.
  test.each([
    { scenario: "import", behavior: "archives and restores the imported path" },
    {
      scenario: "alias cleanup",
      behavior: "preserves dangling aliases until the user repairs the path",
    },
    { scenario: "archive save", behavior: "finishes archiving after the save fails" },
    {
      scenario: "renamed branch",
      behavior: "recovers from snapshot and deletion failures and restores the renamed branch",
    },
  ] as const)(
    "native worktree alias $behavior",
    async ({ scenario }) => {
      const directory = path.join(root, "external-worktree");
      const alias = path.join(root, "native-alias");
      const originalTarget = {
        kind: "local_worktree",
        workingDirectory: alias,
        branchName: "feature/external",
        worktreeState: "present",
      } as const;
      gitCommand("worktree", "add", "-b", originalTarget.branchName, directory);
      await symlink(directory, alias, "junction");
      const h = setup({ actions: false });
      const session =
        scenario === "import"
          ? await importNativeAlias(h, alias)
          : await saveWorktreeSession(originalTarget, externalAliasId);
      expect(session.executionTarget).toEqual(originalTarget);

      const renamed = scenario === "renamed branch";
      const branchName = renamed ? "feature/renamed" : originalTarget.branchName;
      if (renamed) gitCommand("-C", alias, "branch", "-m", branchName);
      const confirmedTarget = { ...originalTarget, branchName };
      const ref = { workspaceId: "fairnest", sessionId: session.id };
      const restore = scenario === "import" || renamed;
      if (restore) {
        await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=restored\n");
        const preview = await h.router.invoke("workspace_session_archive_preview", ref);
        expect(preview).toMatchObject({ branchName, worktreeExists: true });
      }
      const archiveInput = {
        ...ref,
        confirmStop: true,
        removeWorktree: true,
        worktreeConfirmation: { workingDirectory: alias, branchName },
      };
      const failureStages = {
        import: [],
        "alias cleanup": ["alias cleanup"],
        "archive save": ["archive save"],
        "renamed branch": ["branch snapshot save", "branch deletion"],
      } as const;
      for (const stage of failureStages[scenario]) {
        const failure = Effect.fail(
          new HostOperationError({
            operation: "test.archive",
            message: `Injected ${stage} failure`,
          }),
        );
        const failingService = createWorkspaceSessionService({
          ...h.dependencies,
          worktreeFiles: {
            ...h.dependencies.worktreeFiles,
            prepareWorktreeAliasRemoval: (aliasPath, canonicalPath) =>
              h.dependencies.worktreeFiles
                .prepareWorktreeAliasRemoval(aliasPath, canonicalPath)
                .pipe(
                  Effect.map((prepared) => ({
                    remove: stage === "alias cleanup" ? failure : prepared.remove,
                  })),
                ),
          },
          git: {
            ...h.dependencies.git,
            deleteLocalBranch: (...args) =>
              stage === "branch deletion" ? failure : h.dependencies.git.deleteLocalBranch(...args),
          },
          store: {
            ...h.dependencies.store,
            setExecutionTarget: (input) =>
              stage === "branch snapshot save"
                ? failure
                : h.dependencies.store.setExecutionTarget(input),
            archive: (input) =>
              stage === "archive save" ? failure : h.dependencies.store.archive(input),
          },
        });
        await expect(Effect.runPromise(failingService.archive(archiveInput))).rejects.toThrow(
          stage === "archive save"
            ? "Could not save the archived session"
            : `Injected ${stage} failure`,
        );
        if (stage === "branch snapshot save") {
          expect(registeredWorktreePaths()).toContain(directory);
          expect(await realpath(alias)).toBe(directory);
        } else {
          expect(registeredWorktreePaths()).not.toContain(directory);
        }
        if (stage === "branch deletion") {
          expect(gitCommand("branch", "--list", branchName)).toContain(branchName);
          await expect(lstat(alias)).rejects.toThrow("ENOENT");
        }
        expect(await h.router.invoke("workspace_session_get", ref)).toEqual({
          ...session,
          executionTarget: stage === "branch snapshot save" ? originalTarget : confirmedTarget,
        });
      }

      const retryRouter = toPromiseHostCommandRouter(
        createEffectHostCommandRouter({
          handlers: createWorkspaceSessionCommandHandlers(
            createWorkspaceSessionService(h.dependencies),
            () => Effect.void,
          ),
        }),
      );
      if (scenario === "alias cleanup") {
        await expect(retryRouter.invoke("workspace_session_archive", archiveInput)).rejects.toThrow(
          "Cannot verify dangling worktree alias",
        );
        expect(await readlink(alias)).toBe(directory);
        expect(gitCommand("branch", "--list", branchName)).toContain(branchName);

        const replacement = path.join(root, "unrelated-missing");
        await unlink(alias);
        await symlink(replacement, alias, "junction");
        await expect(retryRouter.invoke("workspace_session_archive", archiveInput)).rejects.toThrow(
          "Cannot verify dangling worktree alias",
        );
        expect(await readlink(alias)).toBe(replacement);
        expect(gitCommand("branch", "--list", branchName)).toContain(branchName);
        expect(await h.router.invoke("workspace_session_get", ref)).toEqual(session);
        // Model the explicit user repair requested by the error, then retry.
        await unlink(alias);
      }
      const archived = await retryRouter.invoke("workspace_session_archive", archiveInput);
      expect(archived).toEqual({
        ...session,
        archivedAt: expect.any(Number),
        executionTarget: { ...confirmedTarget, worktreeState: "removed" },
      });
      expect(registeredWorktreePaths()).not.toContain(directory);
      expect(gitCommand("branch", "--list", branchName)).toBe("");
      await expect(realpath(alias)).rejects.toThrow("ENOENT");
      expect(await h.router.invoke("workspace_session_get", ref)).toEqual(archived);
      if (!restore) return;

      const restored = await h.router.invoke("workspace_session_restore", ref);
      expect(restored.executionTarget).toEqual(confirmedTarget);
      expect(restored.externalSessionId).toBe(externalAliasId);
      expect(restored.archivedAt).toBeNull();
      expect(registeredWorktreePaths()).toContain(await realpath(alias));
      expect(runGit(alias, "branch", "--show-current")).toBe(branchName);
      expect(await readFile(path.join(alias, ".env"), "utf8")).toBe("TEST_VALUE=restored\n");
      expect(await h.router.invoke("workspace_session_get", ref)).toEqual(restored);
    },
    15_000,
  );

  // Real Git worktree commands and SQLite writes can exceed the host suite limit on Windows.
  test("keeps the protected default branch with and without its session worktree", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    gitCommand("checkout", "-b", "other-checkout");
    const h = setup({ actions: false });
    const { session } = await h.router.invoke("workspace_session_create", {
      ...h.createInput,
      worktree: { mode: "from_branch", name: "main-review", branchName: "main" },
    });
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    const directory = session.executionTarget.workingDirectory;
    const branchHead = gitCommand("rev-parse", "refs/heads/main");
    await expect(
      h.router.invoke("workspace_session_archive", { ...ref, removeWorktree: true }),
    ).rejects.toThrow("protected branch main");
    expect(registeredWorktreePaths()).toContain(directory);

    gitCommand("worktree", "remove", "--force", directory);
    await expect(h.router.invoke("workspace_session_archive_preview", ref)).rejects.toThrow(
      "protected branch main",
    );
    if (session.executionTarget.kind !== "local_worktree") throw new Error("Expected worktree");
    await expect(
      Effect.runPromise(
        removeWorkspaceSessionWorktree(
          h.targetDependencies,
          h.config,
          session.executionTarget,
          directory,
        ),
      ),
    ).rejects.toThrow("protected branch main");
    await expect(
      h.router.invoke("workspace_session_archive", {
        ...ref,
        removeWorktree: true,
        worktreeConfirmation: { workingDirectory: directory, branchName: "main" },
      }),
    ).rejects.toThrow("protected branch main");
    expect(await h.router.invoke("workspace_session_get", ref)).toEqual(session);

    const archived = await h.router.invoke("workspace_session_archive", {
      ...ref,
      removeWorktree: false,
    });
    expect(archived.executionTarget).toEqual(session.executionTarget);
    expect(archived.archivedAt).not.toBeNull();
    await expect(h.router.invoke("workspace_session_restore", ref)).rejects.toThrow(
      "Cannot restore because branch main already exists",
    );
    expect(await h.router.invoke("workspace_session_get", ref)).toEqual(archived);
    expect(gitCommand("rev-parse", "refs/heads/main")).toBe(branchHead);
    expect(gitCommand("branch", "--show-current")).toBe("other-checkout");
    expect(registeredWorktreePaths()).not.toContain(directory);
  }, 15_000);
});
