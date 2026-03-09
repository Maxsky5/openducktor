import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentRole, AgentScenario, KanbanColumn as KanbanColumnData } from "@openducktor/core";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type KanbanSessionStartIntent = {
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  startMode: "fresh" | "reuse_latest";
  sendKickoff: boolean;
};

export type KanbanPageHeaderModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  onCreateTask: () => void;
  onRefreshTasks: () => void;
};

export type KanbanPageContentModel = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  columns: KanbanColumnData[];
  runStateByTaskId: Map<string, RunSummary["state"]>;
  activeSessionsByTaskId: Map<string, AgentSessionState[]>;
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
};

export type KanbanPageTaskComposerModel = {
  open: boolean;
  task: TaskCard | null;
  tasks: TaskCard[];
  onOpenChange: (open: boolean) => void;
};

export type KanbanPageDetailsSheetModel = {
  task: TaskCard | null;
  allTasks: TaskCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onBuild: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onEdit: (taskId: string) => void;
  onDefer: (taskId: string) => void;
  onResumeDeferred: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
  onDelete: (taskId: string, options: { deleteSubtasks: boolean }) => Promise<void>;
};

export type KanbanPageModels = {
  header: KanbanPageHeaderModel;
  content: KanbanPageContentModel;
  taskComposer: KanbanPageTaskComposerModel;
  detailsSheet: KanbanPageDetailsSheetModel;
  sessionStartModal: SessionStartModalModel | null;
};
