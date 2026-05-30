import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import { defaultEnsureBeadsAttachment } from "../../infrastructure/beads/beads-attachment-provisioning";
import {
  type BeadsCliContext,
  type BeadsCliContextResolutionError,
  type BeadsSharedServerContext,
  type BeadsSharedServerPaths,
  type BeadsSharedServerState,
  canonicalOrAbsolute,
  databaseName,
  databaseNameForWorkspace,
  type ResolveBeadsCliContextOptions,
  type ResolveBeadsOptionalServerContextOptions,
  type ResolveBeadsSharedServerContextOptions,
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
  BeadsCliContextResolutionError,
  BeadsCommandRunner,
  BeadsSharedServerContext,
  BeadsSharedServerPaths,
  BeadsSharedServerState,
  BeadsToolPaths,
  EnsureBeadsAttachment,
  EnsureSharedDoltServer,
  ResolveBeadsCliContextOptions,
  ResolveBeadsCliContextRequestOptions,
  ResolveBeadsOptionalServerContextOptions,
  ResolveBeadsSharedServerContextOptions,
  SharedDoltToolPaths,
} from "../../infrastructure/beads/beads-context-model";
export type { StopSharedDoltServer } from "../../infrastructure/beads/beads-shared-dolt-server";
export { stopOwnedSharedDoltServer } from "../../infrastructure/beads/beads-shared-dolt-server";

export function resolveBeadsCliContext(
  repoPath: string,
  options: ResolveBeadsSharedServerContextOptions,
): Effect.Effect<BeadsSharedServerContext, BeadsCliContextResolutionError>;
export function resolveBeadsCliContext(
  repoPath: string,
  options: ResolveBeadsOptionalServerContextOptions,
): Effect.Effect<BeadsCliContext, BeadsCliContextResolutionError>;
export function resolveBeadsCliContext(
  repoPath: string,
  options: ResolveBeadsCliContextOptions,
): Effect.Effect<BeadsCliContext | BeadsSharedServerContext, BeadsCliContextResolutionError> {
  return Effect.gen(function* () {
    const processEnv = options.processEnv ?? process.env;
    const tools = options.tools;
    const canonicalRepoPath = yield* canonicalOrAbsolute(repoPath).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "beads.resolveCanonicalPath", { repoPath }),
      ),
    );
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
    const createEnv = (sharedServer: BeadsSharedServerState | null): NodeJS.ProcessEnv => {
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

      return env;
    };

    const createContext = (sharedServer: BeadsSharedServerState | null): BeadsCliContext => ({
      repoPath: canonicalRepoPath,
      repoId: resolvedRepoId,
      databaseName: resolvedDatabaseName,
      attachmentRoot,
      beadsDir,
      workingDir: attachmentRoot,
      serverStatePath,
      sharedServer,
      env: createEnv(sharedServer),
      tools,
    });

    if (options.requireSharedServer === true) {
      const sharedServerPaths: BeadsSharedServerPaths = {
        baseDir,
        beadsRoot,
        sharedServerRoot,
        doltRoot,
        cfgDir,
        doltConfigFile: path.join(sharedServerRoot, "dolt-config.yaml"),
        env: processEnv,
        serverStatePath,
        tools: options.sharedDoltTools,
      };
      yield* Effect.tryPromise({
        try: () => mkdir(attachmentRoot, { recursive: true }),
        catch: (cause) =>
          toHostOperationError(cause, "beads.createAttachmentRoot", { attachmentRoot }),
      });
      const sharedServer = yield* ensureSharedDoltServerRunning(
        sharedServerPaths,
        options.ensureSharedServer ?? defaultEnsureSharedDoltServerRunning,
      );
      const sharedContext: BeadsSharedServerContext = {
        ...createContext(sharedServer),
        sharedServer,
        sharedDoltTools: options.sharedDoltTools,
      };
      yield* (options.ensureAttachment ?? defaultEnsureBeadsAttachment)(sharedContext);
      return sharedContext;
    }

    const existingSharedServer = yield* readSharedServerState(serverStatePath).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "beads.readSharedServerState", { repoPath }),
      ),
    );
    return createContext(existingSharedServer);
  });
}
