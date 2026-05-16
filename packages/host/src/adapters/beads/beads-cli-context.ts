import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import { defaultEnsureBeadsAttachment } from "../../infrastructure/beads/beads-attachment-provisioning";
import {
  type BeadsSharedServerPaths,
  canonicalOrAbsolute,
  databaseName,
  databaseNameForWorkspace,
  type ResolveBeadsCliContextOptions,
  repoId,
  resolveOpenDucktorBaseDir,
  SHARED_DOLT_SERVER_HOST,
  SHARED_DOLT_SERVER_USER,
  workspaceRepoId,
} from "../../infrastructure/beads/beads-context-model";
import {
  defaultEnsureSharedDoltServerRunning,
  ensureSharedDoltServerRunning,
  readSharedServerState,
} from "../../infrastructure/beads/beads-shared-dolt-server";

export {
  createBeadsAttachmentProvisioner,
  sharedServerHealthFromContext,
} from "../../infrastructure/beads/beads-attachment-provisioning";
export type {
  BeadsCliContext,
  BeadsCommandRunner,
  BeadsSharedServerPaths,
  BeadsSharedServerState,
  EnsureBeadsAttachment,
  EnsureSharedDoltServer,
  ResolveBeadsCliContextOptions,
} from "../../infrastructure/beads/beads-context-model";
export type { StopSharedDoltServer } from "../../infrastructure/beads/beads-shared-dolt-server";
export { stopOwnedSharedDoltServer } from "../../infrastructure/beads/beads-shared-dolt-server";

export const resolveBeadsCliContext = (
  repoPath: string,
  options: ResolveBeadsCliContextOptions = {},
) =>
  Effect.gen(function* () {
    const processEnv = options.processEnv ?? process.env;
    const canonicalRepoPath = yield* Effect.tryPromise({
      try: () => canonicalOrAbsolute(repoPath),
      catch: (cause) => toHostOperationError(cause, "beads.resolveCanonicalPath", { repoPath }),
    });
    const baseDir = resolveOpenDucktorBaseDir(processEnv);
    const beadsRoot = path.join(baseDir, "beads");
    const sharedServerRoot = path.join(beadsRoot, "shared-server");
    const doltRoot = path.join(sharedServerRoot, "dolt");
    const cfgDir = path.join(sharedServerRoot, ".doltcfg");
    const resolvedWorkspaceId =
      typeof options.workspaceId === "string" && options.workspaceId.trim().length > 0
        ? options.workspaceId.trim()
        : null;
    const resolvedRepoId = resolvedWorkspaceId
      ? workspaceRepoId(resolvedWorkspaceId)
      : repoId(canonicalRepoPath);
    const resolvedDatabaseName = resolvedWorkspaceId
      ? databaseNameForWorkspace(resolvedWorkspaceId)
      : databaseName(canonicalRepoPath);
    const attachmentRoot = path.join(beadsRoot, resolvedRepoId);
    const beadsDir = path.join(attachmentRoot, ".beads");
    const serverStatePath = path.join(sharedServerRoot, "server.json");
    const sharedServerPaths: BeadsSharedServerPaths = {
      baseDir,
      beadsRoot,
      sharedServerRoot,
      doltRoot,
      cfgDir,
      doltConfigFile: path.join(sharedServerRoot, "dolt-config.yaml"),
      env: processEnv,
      serverStatePath,
    };
    let sharedServer = yield* Effect.tryPromise({
      try: () => readSharedServerState(serverStatePath),
      catch: (cause) => toHostOperationError(cause, "beads.readSharedServerState", { repoPath }),
    });

    if (options.requireSharedServer === true) {
      yield* Effect.tryPromise({
        try: () => mkdir(attachmentRoot, { recursive: true }),
        catch: (cause) =>
          toHostOperationError(cause, "beads.createAttachmentRoot", { attachmentRoot }),
      });
      sharedServer = yield* ensureSharedDoltServerRunning(
        sharedServerPaths,
        options.ensureSharedServer ?? defaultEnsureSharedDoltServerRunning,
      );
    }

    const env: NodeJS.ProcessEnv = {
      ...processEnv,
      BEADS_DIR: beadsDir,
    };

    if (sharedServer) {
      env.BEADS_DOLT_SERVER_MODE = "1";
      env.BEADS_DOLT_SERVER_HOST = sharedServer.host || SHARED_DOLT_SERVER_HOST;
      env.BEADS_DOLT_SERVER_PORT = String(sharedServer.port);
      env.BEADS_DOLT_SERVER_USER = sharedServer.user || SHARED_DOLT_SERVER_USER;
    }

    const context = {
      repoPath: canonicalRepoPath,
      repoId: resolvedRepoId,
      databaseName: resolvedDatabaseName,
      attachmentRoot,
      beadsDir,
      workingDir: attachmentRoot,
      serverStatePath,
      sharedServer,
      env,
    };

    if (options.requireSharedServer === true) {
      yield* (options.ensureAttachment ?? defaultEnsureBeadsAttachment)(context);
    }

    return context;
  });
