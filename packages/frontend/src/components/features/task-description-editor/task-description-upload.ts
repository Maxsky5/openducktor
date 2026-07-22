import { type TaskAssetStageResult, taskAssetMediaTypeSchema } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";

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

export const stageTaskDescriptionImage = async (
  client: Pick<HostClient, "taskAssetStage">,
  workspaceId: string,
  file: File,
): Promise<TaskAssetStageResult> => {
  const mediaType = taskAssetMediaTypeSchema.safeParse(file.type);
  if (!mediaType.success) {
    throw new Error("Task images must be PNG, JPEG, WebP, or GIF files.");
  }
  return client.taskAssetStage({
    workspaceId,
    scope: "description",
    originalName: file.name || "image",
    declaredMediaType: mediaType.data,
    bytesBase64: await fileToBase64(file),
  });
};
