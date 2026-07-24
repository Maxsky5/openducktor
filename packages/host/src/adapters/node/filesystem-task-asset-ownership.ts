import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { taskAssetIdSchema } from "@openducktor/contracts";
import { processIsAlive } from "../../infrastructure/process/process-tree";

export type TaskAssetFileOwner = {
  version: 1;
  instanceId: string;
  processId: number;
  startedAtMs: number;
};

export type TaskAssetFileOwnershipDependencies = {
  owner: TaskAssetFileOwner;
  processIsAlive(processId: number): boolean;
  processStartedAtMs(processId: number): Promise<number>;
};

const execFileAsync = promisify(execFile);

const readProcessStartedAtMs = async (processId: number): Promise<number> => {
  const { stdout } =
    process.platform === "win32"
      ? await execFileAsync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-Process -Id ${processId} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
          ],
          { windowsHide: true },
        )
      : await execFileAsync("ps", ["-p", processId.toString(), "-o", "lstart="], {
          env: { ...process.env, LC_ALL: "C" },
        });
  const startedAtMs = Date.parse(stdout.trim());
  if (!Number.isFinite(startedAtMs)) {
    throw new Error(`Could not read the start time for process ${processId}.`);
  }
  return startedAtMs;
};

const isMissing = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";

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

const validateOwner = (value: unknown): TaskAssetFileOwner => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Task asset owner record must be an object.");
  }
  const owner = value as Partial<TaskAssetFileOwner>;
  if (
    owner.version !== 1 ||
    !taskAssetIdSchema.safeParse(owner.instanceId).success ||
    !Number.isSafeInteger(owner.processId) ||
    (owner.processId ?? 0) <= 0 ||
    !Number.isSafeInteger(owner.startedAtMs) ||
    (owner.startedAtMs ?? -1) < 0
  ) {
    throw new Error("Task asset owner record is invalid.");
  }
  return owner as TaskAssetFileOwner;
};

const defaultOwnership = (): TaskAssetFileOwnershipDependencies => ({
  owner: {
    version: 1,
    instanceId: randomUUID(),
    processId: process.pid,
    startedAtMs: Date.now(),
  },
  processIsAlive,
  processStartedAtMs: readProcessStartedAtMs,
});

export const createTaskAssetFileOwnership = (
  {
    configDir,
  }: {
    configDir: string;
  },
  dependencies: TaskAssetFileOwnershipDependencies = defaultOwnership(),
) => {
  const stagingRoot = path.resolve(configDir, "task-asset-staging");
  const quarantineRoot = path.resolve(configDir, "task-asset-quarantine");
  const ownersRoot = path.resolve(configDir, "task-asset-owners");
  const ownedStagingRoot = path.join(stagingRoot, "instances", dependencies.owner.instanceId);
  const ownedQuarantineRoot = path.join(quarantineRoot, "instances", dependencies.owner.instanceId);
  const ownerMarkerPath = (instanceId: string) => path.join(ownersRoot, `${instanceId}.json`);
  const quarantineRootFor = (instanceId: string) =>
    path.join(quarantineRoot, "instances", instanceId);

  const ensureCurrent = async (): Promise<void> => {
    await mkdir(ownersRoot, { recursive: true });
    const marker = ownerMarkerPath(dependencies.owner.instanceId);
    try {
      await writeFile(marker, JSON.stringify(dependencies.owner), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (cause) {
      if (
        typeof cause !== "object" ||
        cause === null ||
        !("code" in cause) ||
        cause.code !== "EEXIST"
      ) {
        throw cause;
      }
      const existing = validateOwner(JSON.parse(await readFile(marker, "utf8")));
      if (
        existing.instanceId !== dependencies.owner.instanceId ||
        existing.processId !== dependencies.owner.processId ||
        existing.startedAtMs !== dependencies.owner.startedAtMs
      ) {
        throw new Error("Task asset owner record conflicts with the current host instance.");
      }
    }
  };

  const readOwners = async (): Promise<TaskAssetFileOwner[]> => {
    if (!(await existingStat(ownersRoot))) {
      return [];
    }
    const entries = await readdir(ownersRoot, { withFileTypes: true });
    const owners: TaskAssetFileOwner[] = [];
    for (const entry of entries) {
      const instanceId = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : "";
      if (!entry.isFile() || !taskAssetIdSchema.safeParse(instanceId).success) {
        throw new Error(`Unexpected task asset owner entry '${entry.name}'.`);
      }
      const owner = validateOwner(
        JSON.parse(await readFile(path.join(ownersRoot, entry.name), "utf8")),
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
      if (!dependencies.processIsAlive(owner.processId)) {
        deadOwners.push(owner);
        continue;
      }
      try {
        const processStartedAtMs = await dependencies.processStartedAtMs(owner.processId);
        if (processStartedAtMs > owner.startedAtMs) {
          deadOwners.push(owner);
        }
      } catch (cause) {
        if (!dependencies.processIsAlive(owner.processId)) {
          deadOwners.push(owner);
          continue;
        }
        throw cause;
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
        await rm(path.join(stagingRoot, entry.name), { force: true, recursive: true });
        removed += 1;
      }
    }
    for (const owner of deadOwners) {
      const ownerStagingRoot = path.join(stagingRoot, "instances", owner.instanceId);
      if (await existingStat(ownerStagingRoot)) {
        await rm(ownerStagingRoot, { force: true, recursive: true });
        removed += 1;
      }
      const ownerQuarantineRoot = quarantineRootFor(owner.instanceId);
      const quarantineEntries = (await existingStat(ownerQuarantineRoot))
        ? await readdir(ownerQuarantineRoot)
        : [];
      if (quarantineEntries.length === 0) {
        await rm(ownerQuarantineRoot, { force: true, recursive: true });
        await rm(ownerMarkerPath(owner.instanceId), { force: true });
      }
    }
    return removed;
  };

  const cleanupCurrent = async (): Promise<void> => {
    await ensureCurrent();
    await rm(ownedStagingRoot, { force: true, recursive: true });
    const quarantineEntries = (await existingStat(ownedQuarantineRoot))
      ? await readdir(ownedQuarantineRoot)
      : [];
    if (quarantineEntries.length === 0) {
      await rm(ownedQuarantineRoot, { force: true, recursive: true });
      await rm(ownerMarkerPath(dependencies.owner.instanceId), { force: true });
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
