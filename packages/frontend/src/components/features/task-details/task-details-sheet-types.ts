import type { ActiveWorkspace } from "@/types/state-slices";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

export type TaskDetailsSheetProps = {
  activeWorkspace?: ActiveWorkspace | null;
  task: TaskCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (taskId: string) => void;
  onDelete?: (taskId: string) => Promise<void>;
};
