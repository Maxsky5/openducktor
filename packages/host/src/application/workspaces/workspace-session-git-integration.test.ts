import { HostOperationError } from "../../effect/host-errors";
import { createWorkspaceSessionImportService } from "./workspace-session-import-service";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { removeWorkspaceSessionWorktree } from "./workspace-session-worktree-lifecycle";
import { createTaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cp,
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
import { createWorktreeFileAdapter } from "../../adapters/filesystem/worktree-file-adapter";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { createSystemCommandRunner } from "../../adapters/system/system-command-runner";
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

const commitIdentity = [
  "-c",
  "user.name=Workspace Test",
  "-c",
  "user.email=test@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

const runGit = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

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
    runGit(fixtureRepoPath, "init", "-b", "main");
    runGit(fixtureRepoPath, "config", "core.autocrlf", "false");
    runGit(fixtureRepoPath, "config", "core.eol", "lf");
    await writeFile(path.join(fixtureRepoPath, "tracked.txt"), "committed\n");
    await writeFile(path.join(fixtureRepoPath, ".gitignore"), ".env\nhook-proof.txt\n");
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
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const setup = ({ hooks = true } = {}) => {
    const starts: AgentSessionControlStartInput[] = [];
    const events: WorkspaceSession[] = [];
    const config = repoConfigSchema.parse({
      workspaceId: "fairnest",
      workspaceName: "Test",
      repoPath,
      defaultTargetBranch: { remote: null, branch: "main" },
      branchPrefix: "odt",
      worktreeBasePath: path.join(root, "worktrees"),
      worktreeCopyPaths: [".env"],
      hooks: {
        preStart: hooks
          ? [
              `${JSON.stringify(process.execPath)} -e ${JSON.stringify("require('node:fs').writeFileSync('hook-proof.txt', process.cwd())")}`,
            ]
          : [],
        postComplete: [],
      },
    });
    const targetDependencies = {
      git: createGitCliAdapter({ resolveCommand: () => Effect.succeed("git") }),
      settingsConfig: createSettingsConfigAdapter({ configPath: path.join(root, "settings.json") }),
      worktreeFiles: createWorktreeFileAdapter(),
      systemCommands: createSystemCommandRunner(),
    };
    const store = createSqliteWorkspaceSessionStore(database.contextProvider);
    const dependencies: WorkspaceSessionServiceDependencies = {
      lifecycle: createTaskSessionLifecycleCoordinator(),
      operationGate: createWorkspaceSessionOperationGate(),
      ...targetDependencies,
      store,
      settings: {
        getRepoConfig: () => Effect.succeed(config),
        listCustomAgentRoles: () => Effect.succeed([]),
      },
      runtime: {
        runtimeEnsure: () =>
          Effect.succeed({
            kind: "opencode",
            runtimeId: "test-runtime",
            repoPath,
            taskId: null,
            role: "workspace",
            workingDirectory: repoPath,
            runtimeRoute: { type: "local_http", endpoint: "http://localhost:1234" },
            startedAt: "2026-09-07T00:00:00Z",
            descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
          }),
      },
      live: {
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
        stopSession: () => Effect.dieMessage("Idle sessions must not be stopped"),
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
    };
    return { router, createInput, starts, events, targetDependencies, dependencies };
  };

  test("creates from_branch at the selected branch HEAD instead of the source checkout HEAD", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    const h = setup({ hooks: false });
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
  });

  // Competing requests run real Git worktree operations and SQLite writes on Windows.
  test.each(["create", "restore"] as const)(
    "a failed %s leaves a competing chat's real worktree and files intact",
    async (operation) => {
      await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
      const h = setup({ hooks: false });
      const archived = await Effect.runPromise(
        createSqliteWorkspaceSessionStore(database.contextProvider).create({
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
      const loser = Effect.runPromiseExit(
        Effect.tryPromise({
          try: () =>
            operation === "create"
              ? h.router.invoke("workspace_session_create", h.createInput).then(() => undefined)
              : h.router.invoke("workspace_session_restore", ref).then(() => undefined),
          catch: (cause) => cause,
        }),
      );
      try {
        await Effect.runPromise(Deferred.await(entered));
        const winner = await h.router.invoke("workspace_session_create", h.createInput);
        const directory = winner.session.executionTarget.workingDirectory;
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
        expect(gitCommand("branch", "--list", "odt/named-chat")).toContain("odt/named-chat");
        expect(await h.router.invoke("workspace_session_get", ref)).toEqual(archived);
        expect(
          await h.router.invoke("workspace_session_list_active", { workspaceId: "fairnest" }),
        ).toEqual([winner.session]);
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined));
        await loser;
      }
    },
    10_000,
  );

  test("creates from_name from a dirty checkout with copy, hook, and dirty-source isolation", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    await writeFile(path.join(repoPath, "tracked.txt"), "uncommitted\n");
    await writeFile(path.join(repoPath, "staged.txt"), "staged\n");
    gitCommand("add", "staged.txt");
    await writeFile(path.join(repoPath, "untracked.txt"), "untracked\n");
    const sourceStatus = gitCommand("status", "--porcelain");
    const h = setup();
    const branchName = "feature/archive-review";
    const { session } = await h.router.invoke("workspace_session_create", {
      ...h.createInput,
      worktree: { mode: "from_name", name: "different-directory-name", branchName },
    });
    const directory = session.executionTarget.workingDirectory;
    expect(await readFile(path.join(directory, "tracked.txt"), "utf8")).toBe("committed\n");
    expect(await readFile(path.join(repoPath, "tracked.txt"), "utf8")).toBe("uncommitted\n");
    expect(gitCommand("status", "--porcelain")).toBe(sourceStatus);
    for (const file of ["staged.txt", "untracked.txt"]) {
      await expect(readFile(path.join(directory, file), "utf8")).rejects.toThrow("ENOENT");
    }
    expect(await readFile(path.join(directory, ".env"), "utf8")).toBe("TEST_VALUE=local\n");
    expect(await readFile(path.join(directory, "hook-proof.txt"), "utf8")).toBe(directory);
    expect(
      gitCommand("-C", directory, "rev-parse", "HEAD", "--symbolic-full-name", "HEAD").split("\n"),
    ).toEqual([fixtureHead, `refs/heads/${branchName}`]);
    expect(directory).toBe(await realpath(directory));
    expect(directory).toBe(
      path.join(root, "worktrees", "workspace-sessions", "different-directory-name"),
    );
    expect(h.starts).toEqual([]);
  });

  test("archives a from_name session and removes its worktree and branch", async () => {
    const h = setup({ hooks: false });
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
    const archived = await Effect.runPromise(
      createSqliteWorkspaceSessionStore(database.contextProvider).create({
        workspaceId: "fairnest",
        repoPath,
        session: {
          id: crypto.randomUUID(),
          runtimeKind: "opencode",
          externalSessionId: null,
          executionTarget: {
            kind: "local_worktree",
            workingDirectory: directory,
            branchName,
            worktreeState: "present",
          },
          roleSnapshot: null,
          selectedModel: null,
          generatedTitle: null,
          manualTitle: null,
          createdAt: 1,
          updatedAt: 2,
          archivedAt: null,
        },
      }),
    );
    const ref = { workspaceId: "fairnest", sessionId: archived.id };
    const result = await h.router.invoke("workspace_session_archive", {
      ...ref,
      confirmStop: true,
      removeWorktree: true,
      worktreeConfirmation: { workingDirectory: directory, branchName },
    });
    expect(result.executionTarget).toMatchObject({
      kind: "local_worktree",
      branchName,
      worktreeState: "removed",
    });
    expect(registeredWorktreePaths()).not.toContain(directory);
    expect(gitCommand("branch", "--list", branchName)).toBe("");
    await expect(readFile(path.join(directory, "tracked.txt"), "utf8")).rejects.toThrow();
    expect(
      await h.router.invoke("workspace_session_list_archived", { workspaceId: "fairnest" }),
    ).toEqual([result]);
  });

  test("restores an archived removed-worktree session from the current default branch", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    const h = setup();
    const branchName = "feature/archive-review";
    const directory = path.join(root, "worktrees", "workspace-sessions", "restored-chat");
    const archived = await Effect.runPromise(
      createSqliteWorkspaceSessionStore(database.contextProvider).create({
        workspaceId: "fairnest",
        repoPath,
        session: {
          id: crypto.randomUUID(),
          runtimeKind: "opencode",
          externalSessionId: null,
          executionTarget: {
            kind: "local_worktree",
            workingDirectory: directory,
            branchName,
            worktreeState: "removed",
          },
          roleSnapshot: null,
          selectedModel: null,
          generatedTitle: null,
          manualTitle: null,
          createdAt: 1,
          updatedAt: 2,
          archivedAt: 2,
        },
      }),
    );
    const ref = { workspaceId: "fairnest", sessionId: archived.id };
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
    expect(await readFile(path.join(directory, "hook-proof.txt"), "utf8")).toBe(directory);
    await expect(readFile(path.join(directory, "untracked.txt"), "utf8")).rejects.toThrow();
  });

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
  });

  // Each case runs real Git and SQLite archive and restore work across many child processes.
  test.each([
    null,
    "alias cleanup",
    "branch deletion",
    "archive save",
    "changed branch",
    "branch snapshot save",
    "replacement directory",
    "replacement worktree",
    "replacement dangling alias",
  ] as const)(
    "imports, retries after %s, and restores a native symlink path",
    async (scenario) => {
      const failureStage =
        scenario === "changed branch"
          ? "branch deletion"
          : scenario === "replacement directory" ||
              scenario === "replacement worktree" ||
              scenario === "replacement dangling alias"
            ? "alias cleanup"
            : scenario;
      await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=restored\n");
      const directory = path.join(root, "external-worktree");
      const alias = path.join(root, "native-alias");
      gitCommand("worktree", "add", "-b", "feature/external", directory);
      await symlink(directory, alias, "junction");
      const h = setup({ hooks: false });
      const registry = createLiveSessionAdapterRegistry();
      const metadata = {
        externalSessionId: "external-alias",
        runtimeKind: "opencode" as const,
        workingDirectory: alias,
        title: "Native alias",
        updatedAt: 123,
      };
      await Effect.runPromise(
        registry.register(
          createAgentSessionRuntimeAdapterTestDouble(
            { runtimeId: "test-runtime", repoPath, runtimeKind: "opencode" },
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
        const { session } = await Effect.runPromise(
          importer.importSession({
            workspaceId: "fairnest",
            runtimeKind: "opencode",
            externalSessionId: metadata.externalSessionId,
            workingDirectory: alias,
          }),
        );
        expect(session.executionTarget).toEqual({
          kind: "local_worktree",
          workingDirectory: alias,
          branchName: "feature/external",
          worktreeState: "present",
        });
        const branchChanged = scenario === "changed branch" || scenario === "branch snapshot save";
        const confirmedBranch = branchChanged ? "feature/renamed" : "feature/external";
        if (branchChanged) gitCommand("-C", alias, "branch", "-m", confirmedBranch);
        const confirmedTarget = {
          kind: "local_worktree" as const,
          workingDirectory: alias,
          branchName: confirmedBranch,
          worktreeState: "present" as const,
        };
        const ref = { workspaceId: "fairnest", sessionId: session.id };
        const preview = await h.router.invoke("workspace_session_archive_preview", ref);
        expect(preview).toMatchObject({ branchName: confirmedBranch, worktreeExists: true });
        const archiveInput = {
          ...ref,
          confirmStop: true,
          removeWorktree: true,
          worktreeConfirmation: { workingDirectory: alias, branchName: confirmedBranch },
        };
        if (failureStage) {
          const failure = Effect.fail(
            new HostOperationError({
              operation: "test.archive",
              message: `Injected ${failureStage} failure`,
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
                      remove: failureStage === "alias cleanup" ? failure : prepared.remove,
                    })),
                  ),
            },
            git: {
              ...h.dependencies.git,
              deleteLocalBranch: (...args) =>
                failureStage === "branch deletion"
                  ? failure
                  : h.dependencies.git.deleteLocalBranch(...args),
            },
            store: {
              ...h.dependencies.store,
              setExecutionTarget: (input) =>
                failureStage === "branch snapshot save"
                  ? failure
                  : h.dependencies.store.setExecutionTarget(input),
              archive: (input) =>
                failureStage === "archive save" ? failure : h.dependencies.store.archive(input),
            },
          });
          await expect(Effect.runPromise(failingService.archive(archiveInput))).rejects.toThrow(
            failureStage === "archive save"
              ? "Could not save the archived chat"
              : `Injected ${failureStage} failure`,
          );
          if (failureStage === "branch snapshot save")
            expect(registeredWorktreePaths()).toContain(directory);
          else expect(registeredWorktreePaths()).not.toContain(directory);
          expect(await h.router.invoke("workspace_session_get", ref)).toEqual({
            ...session,
            executionTarget:
              failureStage === "branch snapshot save" ? session.executionTarget : confirmedTarget,
          });
        }
        const retryService = createWorkspaceSessionService(h.dependencies);
        const retryRouter = toPromiseHostCommandRouter(
          createEffectHostCommandRouter({
            handlers: createWorkspaceSessionCommandHandlers(retryService, () => Effect.void),
          }),
        );
        if (
          scenario === "replacement directory" ||
          scenario === "replacement worktree" ||
          scenario === "replacement dangling alias"
        ) {
          await unlink(alias);
          if (scenario === "replacement directory") {
            await mkdir(alias);
            await writeFile(path.join(alias, "keep.txt"), "keep");
          } else if (scenario === "replacement dangling alias") {
            await symlink(path.join(root, "unrelated-missing"), alias, "junction");
          } else {
            const replacementPath = path.join(root, "replacement-worktree");
            gitCommand("worktree", "add", "-b", "feature/replacement", replacementPath);
            await symlink(replacementPath, alias, "junction");
          }
          await expect(
            retryRouter.invoke("workspace_session_archive", archiveInput),
          ).rejects.toThrow();
          expect(gitCommand("branch", "--list", confirmedBranch)).toContain(confirmedBranch);
          if (scenario === "replacement directory")
            expect(await readFile(path.join(alias, "keep.txt"), "utf8")).toBe("keep");
          else if (scenario === "replacement dangling alias")
            expect(await readlink(alias)).toBe(path.join(root, "unrelated-missing"));
          else expect(runGit(alias, "branch", "--show-current")).toBe("feature/replacement");
          expect(await h.router.invoke("workspace_session_get", ref)).toEqual({
            ...session,
            executionTarget: confirmedTarget,
          });
          return;
        }
        if (scenario === "alias cleanup") {
          await expect(
            retryRouter.invoke("workspace_session_archive", archiveInput),
          ).rejects.toThrow("Cannot verify dangling worktree alias");
          expect(await readlink(alias)).toBe(directory);
          expect(gitCommand("branch", "--list", confirmedBranch)).toContain(confirmedBranch);
          // Model the explicit user repair requested by the error, then retry.
          await unlink(alias);
        }
        const archived = await retryRouter.invoke("workspace_session_archive", archiveInput);
        expect(archived.executionTarget).toEqual({
          kind: "local_worktree",
          workingDirectory: alias,
          branchName: confirmedBranch,
          worktreeState: "removed",
        });
        expect(registeredWorktreePaths()).not.toContain(directory);
        expect(gitCommand("branch", "--list", confirmedBranch)).toBe("");
        await expect(realpath(alias)).rejects.toThrow("ENOENT");
        expect(await h.router.invoke("workspace_session_get", ref)).toEqual(archived);
        const restored = await h.router.invoke("workspace_session_restore", ref);
        expect(restored.executionTarget).toEqual(confirmedTarget);
        expect(restored.externalSessionId).toBe(session.externalSessionId);
        expect(restored.archivedAt).toBeNull();
        expect(registeredWorktreePaths()).toContain(await realpath(alias));
        expect(runGit(alias, "branch", "--show-current")).toBe(confirmedBranch);
        expect(await h.router.invoke("workspace_session_get", ref)).toEqual(restored);
      } finally {
        await Effect.runPromise(importer.shutdown());
      }
    },
    10_000,
  );

  test("keeps the default branch after its session worktree disappears", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    gitCommand("checkout", "-b", "other-checkout");
    const h = setup();
    const { session } = await h.router.invoke("workspace_session_create", {
      ...h.createInput,
      worktree: { mode: "from_branch", name: "missing-main-review", branchName: "main" },
    });
    const directory = session.executionTarget.workingDirectory;
    gitCommand("worktree", "remove", "--force", directory);
    const branchHead = gitCommand("rev-parse", "refs/heads/main");
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    await expect(h.router.invoke("workspace_session_archive_preview", ref)).rejects.toThrow(
      "protected branch main",
    );
    if (session.executionTarget.kind !== "local_worktree") throw new Error("Expected worktree");
    const config = repoConfigSchema.parse({
      workspaceId: "fairnest",
      workspaceName: "Test",
      repoPath,
      defaultTargetBranch: { branch: "main" },
    });
    await expect(
      Effect.runPromise(
        removeWorkspaceSessionWorktree(
          h.targetDependencies,
          config,
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
    expect(gitCommand("rev-parse", "refs/heads/main")).toBe(branchHead);
    expect(gitCommand("branch", "--show-current")).toBe("other-checkout");
    expect(await h.router.invoke("workspace_session_get", ref)).toEqual(session);
  });

  test("keeps a protected default-branch worktree when removal is refused", async () => {
    await writeFile(path.join(repoPath, ".env"), "TEST_VALUE=local\n");
    gitCommand("checkout", "-b", "other-checkout");
    const h = setup();
    const { session } = await h.router.invoke("workspace_session_create", {
      ...h.createInput,
      worktree: { mode: "from_branch", name: "main-review", branchName: "main" },
    });
    const ref = { workspaceId: "fairnest", sessionId: session.id };
    await expect(
      h.router.invoke("workspace_session_archive", { ...ref, removeWorktree: true }),
    ).rejects.toThrow("protected branch main");
    expect(registeredWorktreePaths()).toContain(session.executionTarget.workingDirectory);
    const archived = await h.router.invoke("workspace_session_archive", {
      ...ref,
      removeWorktree: false,
    });
    expect(archived.executionTarget).toEqual(session.executionTarget);
    gitCommand("worktree", "remove", "--force", session.executionTarget.workingDirectory);
    await expect(h.router.invoke("workspace_session_restore", ref)).rejects.toThrow();
    expect(await h.router.invoke("workspace_session_get", ref)).toEqual(archived);
  });
});
