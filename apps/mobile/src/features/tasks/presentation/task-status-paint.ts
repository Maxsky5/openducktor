import type { SharedBoardState } from "@openducktor/contracts";
import {
  statusLabel,
  statusTone,
} from "@openducktor/frontend-core/tasks/presentation/task-status-presentation";
import type { Tone } from "@/ui/tones";

/**
 * The color tone of a task status. The desktop tones map to the app tones: AI Review is indigo and
 * Human Review is teal. The status label always shows with the color.
 */
export const taskStatusTone = (status: SharedBoardState): Tone => statusTone(status);

export const taskStatusLabel = (status: SharedBoardState): string => statusLabel(status);
