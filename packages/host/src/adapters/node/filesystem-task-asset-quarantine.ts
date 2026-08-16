import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { taskAssetIdSchema, taskAssetRenderContextSchema } from "@openducktor/contracts";
import type { TaskAssetQuarantine } from "../../ports/task-asset-file-port";

export type QuarantineManifest = TaskAssetQuarantine & { version: 1 };

const ACTIVE_PUBLICATIONS = new Set<string>();
const PUBLICATION_PREFIX = ".publishing-";

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

const validateManifest = (value: unknown): QuarantineManifest => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Task asset quarantine manifest must be an object.");
  }
  const manifest = value as Partial<QuarantineManifest>;
  if (
    manifest.version !== 1 ||
    !taskAssetIdSchema.safeParse(manifest.id).success ||
    !["create", "update", "delete"].includes(manifest.operation ?? "") ||
    !Array.isArray(manifest.assetIds) ||
    !manifest.assetIds.every((id) => taskAssetIdSchema.safeParse(id).success) ||
    !Array.isArray(manifest.promotedAssetIds) ||
    !manifest.promotedAssetIds.every((id) => taskAssetIdSchema.safeParse(id).success) ||
    !taskAssetRenderContextSchema.shape.workspaceId.safeParse(manifest.workspaceId).success ||
    !taskAssetRenderContextSchema.shape.taskId.safeParse(manifest.taskId).success
  ) {
    throw new Error("Task asset quarantine manifest is invalid.");
  }
  return manifest as QuarantineManifest;
};

export const createTaskAssetQuarantineFiles = ({
  durableRoot,
  quarantineRoot,
  reservedDirectoryNames,
}: {
  durableRoot: string;
  quarantineRoot: string;
  reservedDirectoryNames: readonly string[];
}) => {
  const root = (quarantineId: string) => path.join(quarantineRoot, quarantineId);
  const manifestPath = (quarantineId: string) => path.join(root(quarantineId), "manifest.json");
  const durablePath = (workspaceId: string, taskId: string, assetId: string) =>
    path.join(durableRoot, workspaceId, taskId, assetId);
  const read = async (quarantineId: string): Promise<QuarantineManifest> => {
    if (!taskAssetIdSchema.safeParse(quarantineId).success) {
      throw new Error("Task asset quarantine ID is invalid.");
    }
    const bytes = await readFile(manifestPath(quarantineId), "utf8");
    const manifest = validateManifest(JSON.parse(bytes));
    if (manifest.id !== quarantineId) {
      throw new Error("Task asset quarantine manifest ID does not match its directory.");
    }
    return manifest;
  };
  const listIds = async ({
    ignoreMissingEntries = false,
  }: { ignoreMissingEntries?: boolean } = {}): Promise<string[]> => {
    if (!(await existingStat(quarantineRoot))) {
      return [];
    }
    const entries = await readdir(quarantineRoot, { withFileTypes: true }).catch(
      (cause: unknown) => {
        if (isMissing(cause)) {
          return [];
        }
        throw cause;
      },
    );
    const quarantineIds: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(quarantineRoot, entry.name);
      if (entry.name.startsWith(PUBLICATION_PREFIX) && !ACTIVE_PUBLICATIONS.has(entryPath)) {
        await rm(entryPath, { force: true, recursive: true });
        continue;
      }
      if (reservedDirectoryNames.includes(entry.name)) {
        continue;
      }
      if (!entry.isDirectory() || !taskAssetIdSchema.safeParse(entry.name).success) {
        throw new Error(`Unexpected task asset quarantine entry '${entry.name}'.`);
      }
      let childNames: string[];
      try {
        childNames = await readdir(entryPath);
      } catch (cause) {
        if (ignoreMissingEntries && isMissing(cause)) {
          continue;
        }
        throw cause;
      }
      if (!childNames.includes("manifest.json")) {
        if (childNames.length === 0) {
          await rm(entryPath, { force: true, recursive: true });
          continue;
        }
        throw new Error(`Task asset quarantine '${entry.name}' has no manifest.`);
      }
      quarantineIds.push(entry.name);
    }
    return quarantineIds.sort();
  };
  const moves = (manifest: QuarantineManifest) => {
    if (manifest.operation === "delete") {
      return [
        {
          from: path.join(durableRoot, manifest.workspaceId, manifest.taskId),
          to: path.join(root(manifest.id), manifest.taskId),
        },
      ];
    }
    if (manifest.operation === "create") {
      return [];
    }
    return manifest.assetIds.map((assetId) => ({
      from: durablePath(manifest.workspaceId, manifest.taskId, assetId),
      to: path.join(root(manifest.id), assetId),
    }));
  };

  return {
    root,
    async write(manifest: QuarantineManifest): Promise<void> {
      await mkdir(quarantineRoot, { recursive: true });
      const publicationRoot = path.join(
        quarantineRoot,
        `${PUBLICATION_PREFIX}${manifest.id}-${randomUUID()}`,
      );
      ACTIVE_PUBLICATIONS.add(publicationRoot);
      try {
        await mkdir(publicationRoot);
        await writeFile(path.join(publicationRoot, "manifest.json"), JSON.stringify(manifest), {
          flag: "wx",
          mode: 0o600,
        });
        await rename(publicationRoot, root(manifest.id));
      } catch (cause) {
        await rm(publicationRoot, { force: true, recursive: true });
        throw cause;
      } finally {
        ACTIVE_PUBLICATIONS.delete(publicationRoot);
      }
    },
    async claim(destinationRoot: string): Promise<string[]> {
      const claimed: string[] = [];
      await mkdir(destinationRoot, { recursive: true });
      for (const quarantineId of await listIds({ ignoreMissingEntries: true })) {
        const destinationPath = path.join(destinationRoot, quarantineId);
        try {
          await rename(root(quarantineId), destinationPath);
        } catch (cause) {
          if (!isMissing(cause)) {
            throw cause;
          }
          continue;
        }
        if (await existingStat(destinationPath)) {
          claimed.push(quarantineId);
        }
      }
      return claimed;
    },
    async list(): Promise<TaskAssetQuarantine[]> {
      const manifests: TaskAssetQuarantine[] = [];
      for (const quarantineId of await listIds()) {
        const { version: _version, ...entry } = await read(quarantineId);
        manifests.push(entry);
      }
      return manifests;
    },
    read,
    async restore(manifest: QuarantineManifest): Promise<void> {
      for (const move of moves(manifest).toReversed()) {
        const [fromStat, toStat] = await Promise.all([
          existingStat(move.from),
          existingStat(move.to),
        ]);
        if (fromStat && toStat) {
          throw new Error("Both durable and quarantined task asset paths exist.");
        }
        if (toStat) {
          await mkdir(path.dirname(move.from), { recursive: true });
          await rename(move.to, move.from);
        } else if (!fromStat) {
          throw new Error("Neither durable nor quarantined task asset path exists.");
        }
      }
      await rm(root(manifest.id), { force: true, recursive: true });
    },
    async purge(quarantineId: string): Promise<void> {
      const quarantinePath = root(quarantineId);
      if (!(await existingStat(quarantinePath))) {
        return;
      }
      const entries = await readdir(quarantinePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "manifest.json") {
          continue;
        }
        await rm(path.join(quarantinePath, entry.name), { force: true, recursive: true });
      }
      await rm(manifestPath(quarantineId), { force: true });
      await rm(quarantinePath, { force: true, recursive: true });
    },
  };
};
