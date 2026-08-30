import {
  TASK_ASSET_MAX_FILE_BYTES,
  type TaskAssetStageResult,
  taskAssetMediaTypeSchema,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import { host } from "../shared/host";

type TaskDescriptionAssetHostPort = Pick<HostClient, "taskAssetStage" | "taskAssetDiscardStaged">;

export type TaskDescriptionAssetOperations = {
  stageImage(workspaceId: string, file: File): Promise<TaskAssetStageResult>;
  discardStaged(workspaceId: string, assetIds: string[]): Promise<void>;
};

const fileReaderTextSchema = z.string();
const isFileReaderText = (value: FileReader["result"]): value is string =>
  fileReaderTextSchema.safeParse(value).success;

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.onload = () => {
      const result = reader.result;
      if (!isFileReaderText(result)) {
        reject(new Error("Could not read the image."));
        return;
      }
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new Error("Could not encode the image."));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });

export const createTaskDescriptionAssetOperations = (
  hostPort: TaskDescriptionAssetHostPort,
): TaskDescriptionAssetOperations => ({
  async stageImage(workspaceId, file) {
    const mediaType = taskAssetMediaTypeSchema.safeParse(file.type);
    if (!mediaType.success) {
      throw new Error("Task images must be PNG, JPEG, WebP, or GIF files.");
    }
    if (file.size > TASK_ASSET_MAX_FILE_BYTES) {
      throw new Error("Task description images must be 10 MiB or smaller.");
    }
    return hostPort.taskAssetStage({
      workspaceId,
      scope: "description",
      originalName: file.name || "image",
      declaredMediaType: mediaType.data,
      bytesBase64: await fileToBase64(file),
    });
  },
  async discardStaged(workspaceId, assetIds) {
    await hostPort.taskAssetDiscardStaged({ workspaceId, assetIds });
  },
});

const taskDescriptionAssetOperations = createTaskDescriptionAssetOperations(host);

export const useTaskDescriptionAssetOperations = (
  workspaceId: string | null,
): Pick<TaskDescriptionAssetOperations, "discardStaged"> & {
  stageImage(file: File): Promise<TaskAssetStageResult>;
} => {
  const stageImage = useCallback(
    (file: File) => {
      if (!workspaceId) {
        throw new Error("Select a workspace before adding task images.");
      }
      return taskDescriptionAssetOperations.stageImage(workspaceId, file);
    },
    [workspaceId],
  );

  return useMemo(
    () => ({
      stageImage,
      discardStaged: taskDescriptionAssetOperations.discardStaged,
    }),
    [stageImage],
  );
};
