import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { taskAssetIdSchema } from "@openducktor/contracts";
import { z, type JSONType } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import { processIsAlive } from "../../infrastructure/process/process-tree";
import type { TaskAssetFileChanges } from "./filesystem-task-asset-file-safety";
import { readNodeProcessStartedAtMs } from "./filesystem-task-asset-process-start";

const taskAssetFileOwnerSchema = z
  .object({
    version: z.literal(1),
    instanceId: taskAssetIdSchema,
    processId: z.number().int().positive(),
    startedAtMs: z.number().int().nonnegative(),
  })
  .strict();

export type TaskAssetFileOwner = z.infer<typeof taskAssetFileOwnerSchema>;
export type TaskAssetOwnerProbeFailure = Readonly<{
  cause: unknown;
  owner: TaskAssetFileOwner;
}>;
type TaskAssetFileOwnerInput =
  | JSONType
  | {
      version: number;
      instanceId: string | undefined;
      processId: number;
      startedAtMs: number;
    };

export type TaskAssetFileOwnershipDependencies = {
  owner: TaskAssetFileOwner;
  processIsAlive(processId: number): boolean;
  processStartedAtMs(processId: number): Promise<number>;
};

const nodeErrorSchema = z.object({ code: z.string() }).passthrough();
const hasErrorCode = (cause: unknown, code: string): boolean => {
  const parsed = nodeErrorSchema.safeParse(cause);
  return parsed.success && parsed.data.code === code;
};
const isMissing = (cause: unknown): boolean => hasErrorCode(cause, "ENOENT");

const existingStat = async (target: string) => {
  try {
    return await lstat(target);
  } catch (cause) {
    if (isMissing(cause)) {
      return null;
    }
    throw cause;
  }
};

const validateOwner = (value: TaskAssetFileOwnerInput): TaskAssetFileOwner => {
  const result = taskAssetFileOwnerSchema.safeParse(value);
  if (!result.success) {
    throw new HostValidationError({
      field: "taskAssetOwner",
      message: "Task asset owner record is invalid.",
      cause: result.error,
    });
  }
  return result.data;
};

const defaultOwnership = (): TaskAssetFileOwnershipDependencies => ({
  owner: {
    version: 1,
    instanceId: randomUUID(),
    processId: process.pid,
    startedAtMs: Date.now(),
  },
  processIsAlive,
  processStartedAtMs: readNodeProcessStartedAtMs,
});

export const createTaskAssetFileOwnership = (
  {
    configDir,
    fileChanges,
    reportProbeFailure,
  }: {
    configDir: string;
    fileChanges: TaskAssetFileChanges;
    reportProbeFailure(failure: TaskAssetOwnerProbeFailure): Promise<void>;
  },
  dependencies: TaskAssetFileOwnershipDependencies = defaultOwnership(),
) => {
  const stagingRoot = path.resolve(configDir, "task-asset-staging");
  const quarantineRoot = path.resolve(configDir, "task-asset-quarantine");
  const ownersRoot = path.resolve(configDir, "task-asset-owners");
  const ownedStagingRoot = path.join(stagingRoot, "instances", dependencies.owner.instanceId);
  const ownedQuarantineRoot = path.join(quarantineRoot, "instances", dependencies.owner.instanceId);
  const ownerMarkerPath = (instanceId: string) => path.join(ownersRoot, `${instanceId}.json`);
  const ownerPublicationName = (owner: TaskAssetFileOwner) =>
    `.publishing-${owner.instanceId}-${owner.processId}-${owner.startedAtMs}-${randomUUID()}.json`;
  const quarantineRootFor = (instanceId: string) =>
    path.join(quarantineRoot, "instances", instanceId);
  const parseOwnerPublication = (name: string): TaskAssetFileOwner | null => {
    const match =
      /^\.publishing-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([1-9]\d*)-(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.exec(
        name,
      );
    if (!match) {
      return null;
    }
    return validateOwner({
      version: 1,
      instanceId: match[1],
      processId: Number(match[2]),
      startedAtMs: Number(match[3]),
    });
  };

  const ownerIsDead = async (owner: TaskAssetFileOwner): Promise<boolean> => {
    if (!dependencies.processIsAlive(owner.processId)) {
      return true;
    }
    try {
      return (await dependencies.processStartedAtMs(owner.processId)) > owner.startedAtMs;
    } catch (cause) {
      await reportProbeFailure({ cause, owner });
      return false;
    }
  };

  const ensureCurrent = async (): Promise<void> => {
    await fileChanges.ensureDirectory(ownersRoot);
    const marker = ownerMarkerPath(dependencies.owner.instanceId);
    const publication = path.join(ownersRoot, ownerPublicationName(dependencies.owner));
    try {
      await fileChanges.writeNew(publication, JSON.stringify(dependencies.owner));
      await fileChanges.link(publication, marker);
    } catch (cause) {
      if (!hasErrorCode(cause, "EEXIST")) {
        throw cause;
      }
      const existing = validateOwner(z.json().parse(JSON.parse(await readFile(marker, "utf8"))));
      if (
        existing.instanceId !== dependencies.owner.instanceId ||
        existing.processId !== dependencies.owner.processId ||
        existing.startedAtMs !== dependencies.owner.startedAtMs
      ) {
        throw new Error("Task asset owner record conflicts with the current host instance.");
      }
    } finally {
      await fileChanges.remove(publication);
    }
  };

  const readOwners = async (): Promise<TaskAssetFileOwner[]> => {
    if (!(await existingStat(ownersRoot))) {
      return [];
    }
    const entries = await readdir(ownersRoot, { withFileTypes: true });
    const owners: TaskAssetFileOwner[] = [];
    for (const entry of entries) {
      const publicationOwner = parseOwnerPublication(entry.name);
      if (publicationOwner) {
        if (!entry.isFile()) {
          throw new Error(`Unexpected task asset owner entry '${entry.name}'.`);
        }
        if (await ownerIsDead(publicationOwner)) {
          await fileChanges.remove(path.join(ownersRoot, entry.name));
        }
        continue;
      }
      const instanceId = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : "";
      if (!entry.isFile() || !taskAssetIdSchema.safeParse(instanceId).success) {
        throw new Error(`Unexpected task asset owner entry '${entry.name}'.`);
      }
      const owner = validateOwner(
        z.json().parse(JSON.parse(await readFile(path.join(ownersRoot, entry.name), "utf8"))),
      );
      if (owner.instanceId !== instanceId) {
        throw new Error("Task asset owner record ID does not match its filename.");
      }
      owners.push(owner);
    }
    return owners;
  };

  const validateStateDirectories = async (owners: readonly TaskAssetFileOwner[]): Promise<void> => {
    const knownOwnerIds = new Set(owners.map((owner) => owner.instanceId));
    for (const root of [
      path.join(stagingRoot, "instances"),
      path.join(quarantineRoot, "instances"),
    ]) {
      if (!(await existingStat(root))) {
        continue;
      }
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          !taskAssetIdSchema.safeParse(entry.name).success ||
          !knownOwnerIds.has(entry.name)
        ) {
          throw new Error(`Task asset state owner '${entry.name}' has no valid owner record.`);
        }
      }
    }
  };

  const listAll = async (): Promise<TaskAssetFileOwner[]> => {
    await ensureCurrent();
    const owners = await readOwners();
    await validateStateDirectories(owners);
    return owners;
  };

  const listDead = async (): Promise<TaskAssetFileOwner[]> => {
    const deadOwners: TaskAssetFileOwner[] = [];
    for (const owner of await listAll()) {
      if (owner.instanceId === dependencies.owner.instanceId) {
        continue;
      }
      if (await ownerIsDead(owner)) {
        deadOwners.push(owner);
      }
    }
    return deadOwners;
  };

  const clearExpiredStaging = async (): Promise<number> => {
    const deadOwners = await listDead();
    let removed = 0;
    if (await existingStat(stagingRoot)) {
      const legacyEntries = await readdir(stagingRoot, { withFileTypes: true });
      for (const entry of legacyEntries) {
        if (entry.name === "instances") {
          continue;
        }
        await fileChanges.removeTree(path.join(stagingRoot, entry.name));
        removed += 1;
      }
    }
    for (const owner of deadOwners) {
      const ownerStagingRoot = path.join(stagingRoot, "instances", owner.instanceId);
      if (await existingStat(ownerStagingRoot)) {
        await fileChanges.removeTree(ownerStagingRoot);
        removed += 1;
      }
      const ownerQuarantineRoot = quarantineRootFor(owner.instanceId);
      const quarantineEntries = (await existingStat(ownerQuarantineRoot))
        ? await readdir(ownerQuarantineRoot)
        : [];
      if (quarantineEntries.length === 0) {
        await fileChanges.removeTree(ownerQuarantineRoot);
        await fileChanges.remove(ownerMarkerPath(owner.instanceId));
      }
    }
    return removed;
  };

  const cleanupCurrent = async (): Promise<void> => {
    await ensureCurrent();
    await fileChanges.removeTree(ownedStagingRoot);
    const quarantineEntries = (await existingStat(ownedQuarantineRoot))
      ? await readdir(ownedQuarantineRoot)
      : [];
    if (quarantineEntries.length === 0) {
      await fileChanges.removeTree(ownedQuarantineRoot);
      await fileChanges.remove(ownerMarkerPath(dependencies.owner.instanceId));
    }
  };

  return {
    cleanupCurrent,
    clearExpiredStaging,
    ensureCurrent,
    listAll,
    listDead,
    ownedQuarantineRoot,
    ownedStagingRoot,
    quarantineRoot,
    quarantineRootFor,
    stagingRoot,
  };
};
