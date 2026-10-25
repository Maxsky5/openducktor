import {
  type TaskCreateModalControllerOptions,
  useTaskCreateModalController as useSharedTaskCreateModalController,
} from "@openducktor/frontend-core/tasks/create/use-task-create-modal-controller";
import { collectTaskDescriptionAssetIds } from "@/components/features/task-description-editor/task-description-assets";
import { readFileAsBase64 } from "@/lib/read-file-as-base64";

type DesktopTaskCreateModalControllerOptions = Omit<
  TaskCreateModalControllerOptions<File>,
  "readFileBase64" | "createPreviewUrl" | "revokePreviewUrl" | "collectAssetIds"
>;

// The shared controller revokes each preview URL through `revokePreviewUrl`.
// react-doctor-disable-next-line react-doctor/no-create-object-url-without-revoke
const createPreviewUrl = (file: File): string => URL.createObjectURL(file);
const revokePreviewUrl = (url: string): void => URL.revokeObjectURL(url);

/** The New task and Edit task controller with browser files and the remark asset reader. */
export const useTaskCreateModalController = (options: DesktopTaskCreateModalControllerOptions) =>
  useSharedTaskCreateModalController<File>({
    ...options,
    readFileBase64: readFileAsBase64,
    createPreviewUrl,
    revokePreviewUrl,
    collectAssetIds: collectTaskDescriptionAssetIds,
  });
