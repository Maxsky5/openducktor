import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { repoConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { importHostDatabase } from "../../adapters/sqlite/sqlite-host-database-import";
import { createSqliteHostDatabaseManager } from "../../adapters/sqlite/sqlite-task-repository-context";
import { workspaces } from "../../adapters/sqlite/sqlite-host-settings-schema";
import { workspaceSessionOwnership } from "../../test-support/workspace-session-ownership";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createWorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { HostValidationError } from "../../effect/host-errors";

const initializeDatabase = async (
  root: string,
  repo: ReturnType<typeof repoConfigSchema.parse>,
) => {
  const manager = createSqliteHostDatabaseManager({
    configDir: root,
    taskWorkflows: builtinTaskWorkflows,
  });
  const config = createDefaultGlobalConfig();
  config.workspaces[repo.workspaceId] = repo;
  await Effect.runPromise(
    manager.withHostDatabase("test.initialize", (session) =>
      importHostDatabase({
        session,
        configRoot: root,
        config,
      }),
    ),
  );
  return manager;
};

test("does not import Issues into SQLite when a custom Task store is active", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "odt-custom-task-store-"));
  const repoPath = path.join(root, "repo");
  const repoConfig = repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath,
  });
  const settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "getRepoConfigByRepoPath"> = {
    getRepoConfig: () => Effect.succeed(repoConfig),
    getRepoConfigByRepoPath: () => Effect.succeed(repoConfig),
  };
  const scope = { workspaceId: repoConfig.workspaceId, repoPath };
  const manager = await initializeDatabase(root, repoConfig);
  const services = createNodeTaskAssetServices({
    contextManager: manager,
    resolveTaskStoreAccess: ({ access }) => Effect.succeed(access),
    configDir: { root, scope: "test" },
    configuredTaskStore: createTaskStoreTestDouble({}),
    onBackgroundFailure: () => Effect.void,
    // SAFETY: This composition test only reads the two workspace methods above.
    workspaceSettingsService: settings as WorkspaceSettingsService,
  });
  const sourceIssue = {
    providerId: "github",
    scope: "github.com/example/repo",
    sourceId: "42",
    number: "42",
    url: "https://github.com/example/repo/issues/42",
  };
  try {
    await expect(
      Effect.runPromise(
        services.issueImportStore.findLinkedTaskIds({
          ...scope,
          providerId: "github",
          scope: sourceIssue.scope,
          sourceIds: [sourceIssue.sourceId],
        }),
      ),
    ).rejects.toThrow("requires the default SQLite Task store");
    await expect(
      Effect.runPromise(
        services.issueImportStore.createImportedTask({
          ...scope,
          sourceIssue,
          status: "open",
          task: {
            title: "Issue 42",
            description: "Body",
            issueType: "task",
            priority: 2,
            labels: [],
          },
        }),
      ),
    ).rejects.toThrow("requires the default SQLite Task store");
  } finally {
    await Effect.runPromise(services.taskStoreConnectionShutdownStep.run());
    await rm(root, { recursive: true, force: true });
  }
});

test("custom config session ownership and import do not read other installations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "odt-import-config-"));
  const home = spyOn(os, "homedir").mockReturnValue(root);
  const configDir = path.join(root, ".openducktor-local4");
  const scope = { repoPath: path.join(root, "repo"), workspaceId: "repo" };
  const otherStores = [".openducktor", ".openducktor-dev"].map((dir) =>
    path.join(root, dir, "task-stores", "repo", "database.sqlite"),
  );
  for (const file of otherStores) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "unreadable unrelated SQLite store");
  }
  const repoConfig = repoConfigSchema.parse({ ...scope, workspaceName: "Repo" });
  const settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "getRepoConfigByRepoPath"> = {
    getRepoConfig: () => Effect.succeed(repoConfig),
    getRepoConfigByRepoPath: () => Effect.succeed(repoConfig),
  };
  const manager = await initializeDatabase(configDir, repoConfig);
  const services = createNodeTaskAssetServices({
    contextManager: manager,
    resolveTaskStoreAccess: ({ access }) => Effect.succeed(access),
    configDir: { root: configDir, scope: "dev" },
    onBackgroundFailure: () => Effect.void,
    // SAFETY: Session-store composition only uses the two workspace lookup methods above.
    workspaceSettingsService: settings as WorkspaceSettingsService,
  });
  const session: WorkspaceSession = {
    id: "imported",
    runtimeKind: "opencode",
    externalSessionId: "native-session",
    executionTarget: { kind: "local_repo_root", workingDirectory: scope.repoPath },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: "External",
    manualTitle: null,
    targetBranch: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
  try {
    const store = services.workspaceSessionStore;
    expect(await Effect.runPromise(store.listRuntimeOwners(scope))).toEqual([]);
    expect(
      (
        await Effect.runPromise(
          store.importSession({
            ...scope,
            session,
            ownershipScope: workspaceSessionOwnership(scope),
          }),
        )
      ).created,
    ).toBe(true);
    expect(await Effect.runPromise(store.listRuntimeOwners(scope))).toContainEqual(
      expect.objectContaining({
        kind: "workspace",
        runtimeKind: "opencode",
        externalSessionId: "native-session",
        sessionId: "imported",
        archived: false,
      }),
    );
    expect(
      (
        await Effect.runPromise(
          store.importSession({
            ...scope,
            session: { ...session, id: "duplicate" },
            ownershipScope: workspaceSessionOwnership(scope),
          }),
        )
      ).created,
    ).toBe(false);
    for (const file of otherStores)
      expect(await readFile(file, "utf8")).toBe("unreadable unrelated SQLite store");
  } finally {
    await Effect.runPromise(services.taskStoreConnectionShutdownStep.run());
    home.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

test("ownership reads reject removal and stale configured scopes without recreating the database", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "odt-ownership-removal-"));
  const scope = { repoPath: path.join(root, "missing-repo"), workspaceId: "repo" };
  let configured = true;
  const config = repoConfigSchema.parse({ ...scope, workspaceName: "Repo" });
  const settings = createWorkspaceSettingsServiceTestDouble({
    getRepoConfig: () =>
      configured
        ? Effect.succeed(config)
        : Effect.fail(
            new HostValidationError({
              field: "workspaceId",
              message: "Workspace is not configured: repo",
            }),
          ),
    getRepoConfigByRepoPath: () => Effect.succeed(config),
    getWorkspaceCatalog: () =>
      Effect.succeed({
        catalogRevision: 0,
        openWorkspaces: [],
        closedWorkspaces: [],
        incompleteRemovals: [],
      }),
  });
  const admission = createWorkspaceAdmissionService({ workspaceSettingsService: settings });
  const manager = await initializeDatabase(root, config);
  const services = createNodeTaskAssetServices({
    contextManager: manager,
    resolveTaskStoreAccess: admission.resolveTaskStoreAccess,
    configDir: { root, scope: "test" },
    onBackgroundFailure: () => Effect.void,
    workspaceSettingsService: settings,
  });
  const record: WorkspaceSession = {
    id: "owner",
    runtimeKind: "codex",
    externalSessionId: null,
    executionTarget: { kind: "local_repo_root", workingDirectory: scope.repoPath },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    targetBranch: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
  const ownershipRead = { workspaces: [scope] };
  const ownedChat = {
    workspaceId: scope.workspaceId,
    id: record.id,
    runtimeKind: record.runtimeKind,
    externalSessionId: record.externalSessionId,
    workingDirectory: record.executionTarget.workingDirectory,
    generatedTitle: record.generatedTitle,
    manualTitle: record.manualTitle,
    archivedAt: record.archivedAt,
  };
  const databasePath = path.join(root, "task-stores", scope.workspaceId, "database.sqlite");
  try {
    await Effect.runPromise(services.workspaceSessionStore.create({ ...scope, session: record }));
    admission.blockWorkspace({ ...scope, reason: "closed" });
    expect(
      await Effect.runPromise(
        services.workspaceSessionStore.listForWorktreeOwnership(ownershipRead),
      ),
    ).toEqual([ownedChat]);
    await expect(
      Effect.runPromise(
        services.workspaceSessionStore.listForWorktreeOwnership({
          workspaces: [{ ...scope, repoPath: path.join(root, "another-repo") }],
        }),
      ),
    ).rejects.toThrow("no longer matches this repository");
    await Effect.runPromise(admission.reserveWorkspace({ ...scope, operation: "remove" }));
    await expect(
      Effect.runPromise(services.workspaceSessionStore.listForWorktreeOwnership(ownershipRead)),
    ).rejects.toThrow("remove operation is already in progress");
    expect(await Bun.file(databasePath).exists()).toBe(false);
    admission.releaseReservation(scope.workspaceId);
    admission.blockWorkspace({ ...scope, reason: "removal" });
    expect(
      await Effect.runPromise(
        services.workspaceSessionStore.listForWorktreeOwnership(ownershipRead),
      ),
    ).toEqual([ownedChat]);
    configured = false;
    await Effect.runPromise(
      manager.withHostDatabase("test.removeWorkspace", (session) =>
        session.transaction("test.removeWorkspace", (transaction) =>
          transaction.execute(
            (db) => db.delete(workspaces).where(eq(workspaces.workspaceId, scope.workspaceId)),
            "test.removeWorkspace",
          ),
        ),
      ),
    );
    admission.forgetWorkspace(scope.workspaceId);
    await expect(
      Effect.runPromise(services.workspaceSessionStore.listForWorktreeOwnership(ownershipRead)),
    ).rejects.toThrow("workspace no longer matches this repository");
    expect(await Bun.file(databasePath).exists()).toBe(false);
    expect(await Bun.file(path.join(root, "database.sqlite")).exists()).toBe(true);
  } finally {
    await Effect.runPromise(services.taskStoreConnectionShutdownStep.run());
    await rm(root, { recursive: true, force: true });
  }
});
