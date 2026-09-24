import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { repoConfigSchema, type WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-model";
import { createNodeTaskAssetServices } from "./node-task-asset-services";

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
