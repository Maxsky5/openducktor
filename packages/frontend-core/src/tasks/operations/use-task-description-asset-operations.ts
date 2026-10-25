import {
  TASK_ASSET_MAX_FILE_BYTES,
  type TaskAssetStageResult,
  taskAssetMediaTypeSchema,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { useCallback, useMemo } from "react";
import { useHostClient } from "../../connection/client-connection-react";

type TaskDescriptionAssetHostPort = Pick<HostClient, "taskAssetStage" | "taskAssetDiscardStaged">;

/** An image file that a platform picked. Each platform reads its bytes in its own way. */
export type TaskDescriptionImageFile = { name: string; type: string; size: number };

export type TaskDescriptionAssetOperations<F extends TaskDescriptionImageFile> = {
  stageImage(workspaceId: string, file: F): Promise<TaskAssetStageResult>;
  discardStaged(workspaceId: string, assetIds: string[]): Promise<void>;
};

/** Why the host would refuse the image as a task description image, or null when it accepts it. */
export const taskDescriptionImageError = (file: { type: string; size: number }): string | null => {
  if (!taskAssetMediaTypeSchema.safeParse(file.type).success) {
    return "Task images must be PNG, JPEG, WebP, or GIF files.";
  }
  if (file.size > TASK_ASSET_MAX_FILE_BYTES) {
    return "Task description images must be 10 MiB or smaller.";
  }
  return null;
};

export const createTaskDescriptionAssetOperations = <F extends TaskDescriptionImageFile>(
  hostPort: TaskDescriptionAssetHostPort,
  readBase64: (file: F) => Promise<string>,
): TaskDescriptionAssetOperations<F> => ({
  async stageImage(workspaceId, file) {
    const imageError = taskDescriptionImageError(file);
    if (imageError) {
      throw new Error(imageError);
    }
    return hostPort.taskAssetStage({
      workspaceId,
      scope: "description",
      originalName: file.name || "image",
      declaredMediaType: taskAssetMediaTypeSchema.parse(file.type),
      bytesBase64: await readBase64(file),
    });
  },
  async discardStaged(workspaceId, assetIds) {
    await hostPort.taskAssetDiscardStaged({ workspaceId, assetIds });
  },
});

/** Stages and discards description images in a workspace. Pass a stable `readBase64`. */
export const useTaskDescriptionAssetOperations = <F extends TaskDescriptionImageFile>(
  workspaceId: string | null,
  readBase64: (file: F) => Promise<string>,
): Pick<TaskDescriptionAssetOperations<F>, "discardStaged"> & {
  stageImage(file: F): Promise<TaskAssetStageResult>;
} => {
  const host = useHostClient();
  const taskDescriptionAssetOperations = useMemo(
    () => createTaskDescriptionAssetOperations(host, readBase64),
    [host, readBase64],
  );
  const stageImage = useCallback(
    (file: F) => {
      if (!workspaceId) {
        throw new Error("Select a workspace before adding task images.");
      }
      return taskDescriptionAssetOperations.stageImage(workspaceId, file);
    },
    [taskDescriptionAssetOperations, workspaceId],
  );

  return useMemo(
    () => ({
      stageImage,
      discardStaged: taskDescriptionAssetOperations.discardStaged,
    }),
    [stageImage, taskDescriptionAssetOperations],
  );
};
