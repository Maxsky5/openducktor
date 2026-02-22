import type { TaskCard } from "@openducktor/contracts";

export type TaskDetailsSheetProps = {
  task: TaskCard | null;
  allTasks: TaskCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlan?: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild?: (taskId: string) => void;
  onDelegate?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  onDefer?: (taskId: string) => void;
  onResumeDeferred?: (taskId: string) => void;
  onHumanApprove?: (taskId: string) => void;
  onHumanRequestChanges?: (taskId: string) => void;
  onDelete?: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};
