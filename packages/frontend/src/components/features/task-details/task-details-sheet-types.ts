import type { TaskCard } from "@openducktor/contracts";
import type { ActiveWorkspace } from "@/types/state-slices";

export type TaskDetailsSheetProps = {
  activeWorkspace?: ActiveWorkspace | null;
  task: TaskCard | null;
  allTasks: TaskCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (taskId: string) => void;
  onDelete?: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};
