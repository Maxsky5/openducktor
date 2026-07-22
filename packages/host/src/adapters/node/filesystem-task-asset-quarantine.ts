import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { taskAssetIdSchema, taskAssetRenderContextSchema } from "@openducktor/contracts";
import type { TaskAssetQuarantine } from "../../ports/task-asset-file-port";

export type QuarantineManifest = TaskAssetQuarantine & { version: 1 };

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
    typeof manifest.workspaceId !== "string" ||
    typeof manifest.taskId !== "string" ||
    !taskAssetRenderContextSchema.safeParse({
      workspaceId: manifest.workspaceId,
      taskId: manifest.taskId,
      scope: "description",
      assetId: "00000000-0000-4000-8000-000000000000",
    }).success
  ) {
    throw new Error("Task asset quarantine manifest is invalid.");
  }
  return manifest as QuarantineManifest;
};

export const createTaskAssetQuarantineFiles = ({
  durableRoot,
  quarantineRoot,
}: {
  durableRoot: string;
  quarantineRoot: string;
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
      await mkdir(root(manifest.id), { recursive: true });
      await writeFile(manifestPath(manifest.id), JSON.stringify(manifest), {
        flag: "wx",
        mode: 0o600,
      });
    },
    async list(): Promise<TaskAssetQuarantine[]> {
      if (!(await existingStat(quarantineRoot))) {
        return [];
      }
      const entries = await readdir(quarantineRoot, { withFileTypes: true });
      const quarantineIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const manifests: TaskAssetQuarantine[] = [];
      for (const quarantineId of quarantineIds) {
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
      await rm(root(quarantineId), { force: true, recursive: true });
    },
  };
};
