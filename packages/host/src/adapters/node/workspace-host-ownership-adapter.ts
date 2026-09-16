import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Deferred, Effect, Exit } from "effect";
import { lock as acquireFileLock, type LockOptions } from "proper-lockfile";
import { z } from "zod";
import { resolveOpenDucktorBaseDir } from "../../config/openducktor-config-dir";
import {
  HostOperationError,
  HostValidationError,
  type HostOperationErrorAggregate,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import {
  currentProcessStartedAtMs,
  readProcessStartedAtMs,
} from "../../infrastructure/process/process-start-time";
import { processIsAlive } from "../../infrastructure/process/process-tree";
import type { WorkspaceHostOwnershipPort } from "../../ports/workspace-host-ownership-port";
import type { WorkspaceOwnershipLock } from "../../application/workspaces/workspace-ownership-lock";

const OWNER_LOCK_STALE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEAD_OWNER_LOCK_STALE_MS = 30_000;
const PROCESS_START_TIME_TOLERANCE_MS = 2_000;
const PATH_OWNER_ID = "workspace-path-ownership";

const workspaceHostOwnerSchema = z
  .object({
    version: z.literal(1),
    instanceId: z.string().uuid(),
    processId: z.number().int().positive(),
    startedAtMs: z.number().int().nonnegative(),
    workspaceId: z.string().min(1),
  })
  .strict();

type WorkspaceHostOwner = z.infer<typeof workspaceHostOwnerSchema>;

type WorkspaceHostIdentity = Pick<WorkspaceHostOwner, "instanceId" | "processId" | "startedAtMs">;

type WorkspaceClaim = {
  owner: WorkspaceHostOwner;
  ownerPath: string;
  release: () => Promise<void>;
};

type WorkspaceHostOwnershipDependencies = {
  identity: WorkspaceHostIdentity;
  processIsAlive(processId: number): boolean;
  processStartedAtMs(processId: number): Promise<number>;
};

type WorkspaceOwnershipLockDependencies = WorkspaceHostOwnershipDependencies & {
  acquireFileLock: typeof acquireFileLock;
};

type WorkspacePathClaim = {
  compromised: Deferred.Deferred<never, HostOperationErrorAggregate>;
  owner: WorkspaceHostOwner;
  release: () => Promise<void>;
  state: { compromised: boolean };
};

const defaultDependencies = (): WorkspaceHostOwnershipDependencies => ({
  identity: {
    instanceId: randomUUID(),
    processId: process.pid,
    startedAtMs: currentProcessStartedAtMs(),
  },
  processIsAlive,
  processStartedAtMs: readProcessStartedAtMs,
});

const defaultOwnershipLockDependencies = (): WorkspaceOwnershipLockDependencies => ({
  ...defaultDependencies(),
  acquireFileLock,
});

const errorCode = (cause: unknown): string | null => {
  const result = z.object({ code: z.string() }).safeParse(cause);
  return result.success ? result.data.code : null;
};

const ownerFileName = (workspaceId: string): string =>
  `${createHash("sha256").update(workspaceId).digest("hex")}.json`;

const ownerMismatchError = (workspaceId: string, ownerPath: string, cause?: unknown) =>
  new HostOperationError({
    operation: "workspaceHostOwnership.verify",
    message: `Cannot verify the OpenDucktor host that owns workspace ${workspaceId}. Close other OpenDucktor instances and retry.`,
    cause,
    details: { ownerPath, workspaceId },
  });

const unreadableOwnerError = (workspaceId: string, ownerPath: string, cause: unknown) =>
  new HostOperationError({
    operation: "workspaceHostOwnership.verify",
    message: `Cannot read the owner record for workspace ${workspaceId}. Close all OpenDucktor instances, delete ${ownerPath} and ${ownerPath}.lock, then retry.`,
    cause,
    details: { ownerPath, workspaceId },
  });

const readOwner = async (ownerPath: string, workspaceId: string): Promise<WorkspaceHostOwner> => {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(ownerPath, "utf8"));
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") {
      throw ownerMismatchError(workspaceId, ownerPath, cause);
    }
    throw unreadableOwnerError(workspaceId, ownerPath, cause);
  }
  const result = workspaceHostOwnerSchema.safeParse(value);
  if (!result.success) {
    throw unreadableOwnerError(workspaceId, ownerPath, result.error);
  }
  if (result.data.workspaceId !== workspaceId) {
    throw ownerMismatchError(workspaceId, ownerPath);
  }
  return result.data;
};

const readOwnerIfPresent = async (
  ownerPath: string,
  workspaceId: string,
): Promise<WorkspaceHostOwner | null> => {
  try {
    return await readOwner(ownerPath, workspaceId);
  } catch (cause) {
    if (cause instanceof HostOperationError && errorCode(cause.cause) === "ENOENT") {
      return null;
    }
    throw cause;
  }
};

const ownerIsAlive = async (
  owner: WorkspaceHostOwner,
  dependencies: WorkspaceHostOwnershipDependencies,
): Promise<boolean> => {
  if (!dependencies.processIsAlive(owner.processId)) {
    return false;
  }
  try {
    return (
      (await dependencies.processStartedAtMs(owner.processId)) <=
      owner.startedAtMs + PROCESS_START_TIME_TOLERANCE_MS
    );
  } catch (cause) {
    if (!dependencies.processIsAlive(owner.processId)) {
      return false;
    }
    throw ownerMismatchError(owner.workspaceId, "process", cause);
  }
};

const acquireLock = (
  ownerPath: string,
  stale: number,
  lock: typeof acquireFileLock = acquireFileLock,
  onCompromised?: (error: Error) => void,
) => {
  const options: LockOptions = {
    realpath: false,
    retries: 0,
    stale,
    update: Math.min(60_000, stale / 3),
  };
  if (onCompromised) options.onCompromised = onCompromised;
  return lock(ownerPath, options);
};

const publishOwner = async (ownerPath: string, owner: WorkspaceHostOwner): Promise<void> => {
  const publicationPath = `${ownerPath}.${owner.instanceId}.tmp`;
  try {
    await writeFile(publicationPath, JSON.stringify(owner), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(publicationPath, ownerPath);
  } finally {
    await rm(publicationPath, { force: true });
  }
};

const recoveryError = (
  workspaceId: string,
  ownerPath: string,
  owner: WorkspaceHostOwner | null,
  cause: unknown,
) =>
  new HostOperationError({
    operation: "workspaceHostOwnership.recover",
    message: owner
      ? `The previous OpenDucktor host for workspace ${workspaceId} stopped recently. Wait 30 seconds and retry.`
      : `An OpenDucktor host stopped while publishing ownership for workspace ${workspaceId}. Wait 30 seconds and retry.`,
    cause,
    details: { owner, ownerPath, workspaceId },
  });

const releaseRecoveryError = (workspaceId: string, ownerPath: string, cause?: unknown) =>
  new HostOperationError({
    operation: "workspaceHostOwnership.release",
    message: `The workspace ownership release did not finish for ${workspaceId}. Restart OpenDucktor, wait 30 seconds, and retry the removal.`,
    cause,
    details: { ownerPath, workspaceId },
  });

const mapClaimError = (
  cause: unknown,
  workspaceId: string,
  ownerPath: string,
): HostOperationErrorAggregate | HostValidationErrorAggregate => {
  if (cause instanceof HostOperationError || cause instanceof HostValidationError) {
    return cause;
  }
  return new HostOperationError({
    operation: "workspaceHostOwnership.claim",
    message: `Failed to claim workspace ${workspaceId} for this OpenDucktor host. Close other OpenDucktor instances and retry.`,
    cause,
    details: { ownerPath, workspaceId },
  });
};

export const createNodeWorkspaceHostOwnership = (
  {
    processEnv = process.env,
  }: {
    processEnv?: NodeJS.ProcessEnv;
  } = {},
  dependencies: WorkspaceHostOwnershipDependencies = defaultDependencies(),
): WorkspaceHostOwnershipPort => {
  const configDir = resolveOpenDucktorBaseDir("production", processEnv);
  const ownersRoot = path.join(configDir, "workspace-host-owners");
  const claims = new Map<string, WorkspaceClaim>();
  const semaphore = Effect.runSync(Effect.makeSemaphore(1));
  const claimWorkspace = (workspaceId: string) =>
    semaphore.withPermits(1)(
      Effect.tryPromise({
        try: async () => {
          if (claims.has(workspaceId)) {
            return false;
          }

          await mkdir(ownersRoot, { recursive: true });
          const ownerPath = path.join(ownersRoot, ownerFileName(workspaceId));
          let release: (() => Promise<void>) | undefined;
          try {
            release = await acquireLock(ownerPath, OWNER_LOCK_STALE_MS);
          } catch (cause) {
            if (errorCode(cause) !== "ELOCKED") {
              throw cause;
            }
            const existingOwner = await readOwnerIfPresent(ownerPath, workspaceId);
            if (existingOwner && (await ownerIsAlive(existingOwner, dependencies))) {
              throw new HostValidationError({
                message: `Workspace ${workspaceId} is in use by another OpenDucktor host process (${existingOwner.processId}). Close that OpenDucktor instance and retry.`,
                field: "workspaceId",
                details: { owner: existingOwner },
              });
            }
            try {
              release = await acquireLock(ownerPath, DEAD_OWNER_LOCK_STALE_MS);
            } catch (staleCause) {
              if (errorCode(staleCause) === "ELOCKED") {
                throw recoveryError(workspaceId, ownerPath, existingOwner, staleCause);
              }
              throw staleCause;
            }
          }

          const owner = workspaceHostOwnerSchema.parse({
            version: 1,
            ...dependencies.identity,
            workspaceId,
          });
          try {
            await publishOwner(ownerPath, owner);
          } catch (cause) {
            await release();
            throw cause;
          }
          claims.set(workspaceId, { owner, ownerPath, release });
          return true;
        },
        catch: (cause) =>
          mapClaimError(cause, workspaceId, path.join(ownersRoot, ownerFileName(workspaceId))),
      }),
    );

  const releaseClaim = (workspaceId: string, claim: WorkspaceClaim) =>
    Effect.tryPromise({
      try: async () => {
        const owner = await readOwnerIfPresent(claim.ownerPath, workspaceId);
        if (!owner) {
          throw releaseRecoveryError(workspaceId, claim.ownerPath);
        }
        if (owner.instanceId !== claim.owner.instanceId) {
          throw ownerMismatchError(workspaceId, claim.ownerPath);
        }
        await rm(claim.ownerPath, { force: true });
        try {
          await claim.release();
        } catch (cause) {
          throw releaseRecoveryError(workspaceId, claim.ownerPath, cause);
        }
        claims.delete(workspaceId);
      },
      catch: (cause) =>
        cause instanceof HostOperationError
          ? cause
          : new HostOperationError({
              operation: "workspaceHostOwnership.release",
              message: `Failed to release workspace ${workspaceId} from this OpenDucktor host.`,
              cause,
              details: { ownerPath: claim.ownerPath, workspaceId },
            }),
    });

  return {
    claimWorkspace,
    releaseWorkspace: (workspaceId) =>
      semaphore.withPermits(1)(
        Effect.suspend(() => {
          const claim = claims.get(workspaceId);
          return claim ? releaseClaim(workspaceId, claim) : Effect.void;
        }),
      ),
    releaseAll: () =>
      semaphore.withPermits(1)(
        Effect.gen(function* () {
          const results = yield* Effect.forEach(
            Array.from(claims.entries()),
            ([workspaceId, claim]) => Effect.either(releaseClaim(workspaceId, claim)),
            { concurrency: 1 },
          );
          const failures = results.flatMap((result) =>
            result._tag === "Left" ? [result.left] : [],
          );
          if (failures.length > 0) {
            return yield* Effect.fail(
              new HostOperationError({
                operation: "workspaceHostOwnership.releaseAll",
                message: failures.map((failure) => failure.message).join("\n"),
                cause: failures[0],
                details: { failures },
              }),
            );
          }
        }),
      ),
  };
};

export const createNodeWorkspaceOwnershipLock = (
  {
    processEnv = process.env,
  }: {
    processEnv?: NodeJS.ProcessEnv;
  } = {},
  dependencies: WorkspaceOwnershipLockDependencies = defaultOwnershipLockDependencies(),
): WorkspaceOwnershipLock => {
  const configDir = resolveOpenDucktorBaseDir("production", processEnv);
  const ownersRoot = path.join(configDir, "workspace-host-owners");
  const lockTarget = path.join(ownersRoot, "path-ownership");
  const semaphore = Effect.runSync(Effect.makeSemaphore(1));

  const acquire = Effect.gen(function* () {
    const compromised = yield* Deferred.make<never, HostOperationErrorAggregate>();
    const state = { compromised: false };
    const onCompromised = (cause: Error): void => {
      state.compromised = true;
      Effect.runSync(
        Deferred.fail(
          compromised,
          new HostOperationError({
            operation: "workspaceOwnershipLock.compromised",
            message:
              "The workspace path ownership lock was lost. Stop other OpenDucktor hosts and retry the operation.",
            cause,
            details: { lockTarget },
          }),
        ),
      );
    };
    const claim = yield* Effect.tryPromise({
      try: async () => {
        await mkdir(ownersRoot, { recursive: true });
        let release: (() => Promise<void>) | undefined;
        try {
          release = await acquireLock(
            lockTarget,
            Number.MAX_SAFE_INTEGER,
            dependencies.acquireFileLock,
            onCompromised,
          );
        } catch (cause) {
          if (errorCode(cause) !== "ELOCKED") throw cause;
          const existingOwner = await readOwnerIfPresent(lockTarget, PATH_OWNER_ID);
          if (existingOwner && (await ownerIsAlive(existingOwner, dependencies))) {
            throw new HostValidationError({
              message: `Another OpenDucktor host owns the workspace path lock (process ${existingOwner.processId}). Close that OpenDucktor instance and retry.`,
              details: { owner: existingOwner },
            });
          }
          try {
            release = await acquireLock(
              lockTarget,
              DEAD_OWNER_LOCK_STALE_MS,
              dependencies.acquireFileLock,
              onCompromised,
            );
          } catch (staleCause) {
            if (errorCode(staleCause) === "ELOCKED") {
              throw new HostValidationError({
                message:
                  "The OpenDucktor host that owned the workspace path lock stopped in the past 30 seconds. Wait 30 seconds and retry.",
                cause: staleCause,
              });
            }
            throw staleCause;
          }
        }
        const owner = workspaceHostOwnerSchema.parse({
          version: 1,
          ...dependencies.identity,
          workspaceId: PATH_OWNER_ID,
        });
        try {
          await publishOwner(lockTarget, owner);
        } catch (cause) {
          await release();
          throw cause;
        }
        return { compromised, owner, release, state };
      },
      catch: (cause) =>
        cause instanceof HostOperationError || cause instanceof HostValidationError
          ? cause
          : new HostOperationError({
              operation: "workspaceOwnershipLock.acquire",
              message: "Failed to lock workspace path ownership. Retry the operation.",
              cause,
              details: { lockTarget },
            }),
    });
    return claim;
  });

  const releaseLock = (claim: WorkspacePathClaim) =>
    Effect.tryPromise({
      try: async () => {
        let owner: WorkspaceHostOwner | null = null;
        try {
          owner = await readOwnerIfPresent(lockTarget, PATH_OWNER_ID);
        } catch (cause) {
          if (!claim.state.compromised) throw cause;
        }
        if (owner?.instanceId === claim.owner.instanceId) {
          await rm(lockTarget, { force: true });
        } else if (!claim.state.compromised) {
          throw ownerMismatchError(PATH_OWNER_ID, lockTarget);
        }
        try {
          await claim.release();
        } catch (cause) {
          if (!(claim.state.compromised && errorCode(cause) === "ERELEASED")) throw cause;
        }
      },
      catch: (cause) =>
        new HostOperationError({
          operation: "workspaceOwnershipLock.release",
          message: "Failed to release the workspace path ownership lock. Restart OpenDucktor.",
          cause,
          details: { lockTarget },
        }),
    });

  return {
    runExclusive: (effect) =>
      semaphore.withPermits(1)(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const claim = yield* acquire;
            const exit = yield* Effect.exit(
              restore(
                Effect.raceFirst(effect, Effect.interruptible(Deferred.await(claim.compromised))),
              ),
            );
            yield* releaseLock(claim);
            return yield* Exit.matchEffect(exit, {
              onFailure: Effect.failCause,
              onSuccess: Effect.succeed,
            });
          }),
        ),
      ),
  };
};
