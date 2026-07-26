import { type TaskAssetStageResult, taskAssetMediaTypeSchema } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { useCallback, useMemo } from "react";
import { host } from "../shared/host";

type TaskDescriptionAssetHostPort = Pick<HostClient, "taskAssetStage" | "taskAssetDiscardStaged">;

export type TaskDescriptionAssetOperations = {
  stageImage(workspaceId: string, file: File): Promise<TaskAssetStageResult>;
  discardStaged(workspaceId: string, assetIds: string[]): Promise<void>;
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read the image."));
        return;
      }
      const comma = reader.result.indexOf(",");
      if (comma < 0) {
        reject(new Error("Could not encode the image."));
        return;
      }
      resolve(reader.result.slice(comma + 1));
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
