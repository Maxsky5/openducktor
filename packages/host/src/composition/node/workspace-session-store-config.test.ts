import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { repoConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { createNodeTaskAssetServices } from "./node-task-asset-services";
import { createWorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { HostValidationError } from "../../effect/host-errors";

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
  const services = createNodeTaskAssetServices({
    assertOwnershipReadAdmitted: () => Effect.void,
    configDir: { root, scope: "test" },
    configuredTaskStore: createTaskStoreTestDouble({}),
    onBackgroundFailure: () => Effect.void,
    processEnv: {},
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
          repoPath,
          providerId: "github",
          scope: sourceIssue.scope,
          sourceIds: [sourceIssue.sourceId],
        }),
      ),
    ).rejects.toThrow("requires the default SQLite Task store");
    await expect(
      Effect.runPromise(
        services.issueImportStore.createImportedTask({
          repoPath,
          sourceIssue,
          task: {
            title: "Issue 42",
            description: "Body",
            issueType: "task",
            priority: 2,
            labels: [],
            aiReviewEnabled: true,
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
  const services = createNodeTaskAssetServices({
    assertOwnershipReadAdmitted: () => Effect.void,
    configDir: { root: configDir, scope: "dev" },
    processEnv: { OPENDUCKTOR_CONFIG_DIR: configDir },
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
    expect((await Effect.runPromise(store.importSession({ ...scope, session }))).created).toBe(
      true,
    );
    expect(await Effect.runPromise(store.listRuntimeOwners(scope))).toContainEqual({
      kind: "workspace",
      runtimeKind: "opencode",
      externalSessionId: "native-session",
      sessionId: "imported",
      archived: false,
    });
    expect(
      (
        await Effect.runPromise(
          store.importSession({ ...scope, session: { ...session, id: "duplicate" } }),
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
      Effect.succeed({ openWorkspaces: [], closedWorkspaces: [], incompleteRemovals: [] }),
  });
  const admission = createWorkspaceAdmissionService({ workspaceSettingsService: settings });
  const services = createNodeTaskAssetServices({
    configDir: { root, scope: "test" },
    assertWorkspaceAdmitted: admission.assertTaskStoreAccess,
    assertOwnershipReadAdmitted: admission.assertTaskStoreOwnershipReadAccess,
    onBackgroundFailure: () => Effect.void,
    processEnv: {},
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
  const databasePath = path.join(root, "task-stores", scope.workspaceId, "database.sqlite");
  try {
    await Effect.runPromise(services.workspaceSessionStore.create({ ...scope, session: record }));
    admission.blockWorkspace({ ...scope, reason: "closed" });
    expect(
      await Effect.runPromise(services.workspaceSessionStore.listForWorktreeOwnership(scope)),
    ).toEqual([record]);
    await expect(
      Effect.runPromise(
        services.workspaceSessionStore.listForWorktreeOwnership({
          ...scope,
          repoPath: path.join(root, "another-repo"),
        }),
      ),
    ).rejects.toThrow("no longer matches this Repository");
    await Effect.runPromise(admission.reserveWorkspace({ ...scope, operation: "remove" }));
    await Effect.runPromise(services.removeWorkspaceTaskStore(scope.workspaceId));
    await expect(
      Effect.runPromise(services.workspaceSessionStore.listForWorktreeOwnership(scope)),
    ).rejects.toThrow("remove operation is already in progress");
    expect(await Bun.file(databasePath).exists()).toBe(false);
    admission.releaseReservation(scope.workspaceId);
    admission.blockWorkspace({ ...scope, reason: "removal" });
    await expect(
      Effect.runPromise(services.workspaceSessionStore.listForWorktreeOwnership(scope)),
    ).rejects.toThrow("Workspace removal is incomplete");
    configured = false;
    admission.forgetWorkspace(scope.workspaceId);
    await expect(
      Effect.runPromise(services.workspaceSessionStore.listForWorktreeOwnership(scope)),
    ).rejects.toThrow("Workspace is not configured");
    expect(await Bun.file(databasePath).exists()).toBe(false);
  } finally {
    await Effect.runPromise(services.taskStoreConnectionShutdownStep.run());
    await rm(root, { recursive: true, force: true });
  }
});
