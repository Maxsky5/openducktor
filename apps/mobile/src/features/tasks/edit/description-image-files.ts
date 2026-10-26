import type { DeviceFileReference } from "@openducktor/frontend-core/platform/device-file";
import { pickedFileUri } from "@/platform/device-files";

/** The device file of a picked image, to show it before the save. */
export const pickedImagePreviewUri = (file: DeviceFileReference): string => {
  const uri = pickedFileUri(file);
  if (!uri)
    throw new Error(`${file.name} is no longer available on this device. Pick the image again.`);
  return uri;
};

/** Picked files stay in the app cache, so a preview has nothing to release. */
export const releasePickedImagePreview = (): void => {};
