import { rm } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ID_PATTERN } from "@openducktor/contracts";
import type { TaskAssetFileOwner } from "./filesystem-task-asset-ownership";
import type { TaskAssetQuarantine } from "../../ports/task-asset-file-port";

export type WorkspaceQuarantineFiles = {
  list(): Promise<TaskAssetQuarantine[]>;
  purge(quarantineId: string): Promise<void>;
};

export const removeWorkspaceTaskAssetData = async ({
  durableRoot,
  legacyQuarantineFiles,
  ownedStagingRoot,
  ownerState,
  quarantineFiles,
  quarantineFilesForRoot,
  workspaceId,
}: {
  durableRoot: string;
  legacyQuarantineFiles: WorkspaceQuarantineFiles;
  ownedStagingRoot: string;
  ownerState: {
    listAll(): Promise<TaskAssetFileOwner[]>;
    quarantineRootFor(instanceId: string): string;
    stagingRoot: string;
  };
  quarantineFiles: WorkspaceQuarantineFiles;
  quarantineFilesForRoot: (
    quarantineRoot: string,
    reservedDirectoryNames: readonly string[],
  ) => WorkspaceQuarantineFiles;
  workspaceId: string;
}): Promise<void> => {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error("Workspace ID is invalid for task asset cleanup.");
  }
  const owners = await ownerState.listAll();
  await rm(path.join(durableRoot, workspaceId), { force: true, recursive: true });
  for (const stagingDirectory of [
    path.join(ownedStagingRoot, workspaceId),
    ...owners.map((owner) =>
      path.join(ownerState.stagingRoot, "instances", owner.instanceId, workspaceId),
    ),
  ]) {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
  for (const files of [
    legacyQuarantineFiles,
    quarantineFiles,
    ...owners.map((owner) =>
      quarantineFilesForRoot(ownerState.quarantineRootFor(owner.instanceId), []),
    ),
  ]) {
    for (const quarantine of await files.list()) {
      if (quarantine.workspaceId === workspaceId) {
        await files.purge(quarantine.id);
      }
    }
  }
};
