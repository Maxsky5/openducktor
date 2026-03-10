import type { RunSummary, TaskCard } from "@openducktor/contracts";
import { mapToKanbanColumns } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { KanbanPageContentModel } from "./kanban-page-model-types";

const ACTIVE_SESSION_STATUS = new Set<AgentSessionState["status"]>(["starting", "running"]);

type UseKanbanBoardModelArgs = {
  isLoadingTasks: boolean;
  isSwitchingWorkspace: boolean;
  tasks: TaskCard[];
  runs: RunSummary[];
  sessions: AgentSessionState[];
  onOpenDetails: (taskId: string) => void;
  onDelegate: (taskId: string) => void;
  onPlan: (taskId: string, action: "set_spec" | "set_plan") => void;
  onQaStart: (taskId: string) => void;
  onQaOpen: (taskId: string) => void;
  onBuild: (taskId: string) => void;
  onHumanApprove: (taskId: string) => void;
  onHumanRequestChanges: (taskId: string) => void;
};

export function useKanbanBoardModel({
  isLoadingTasks,
  isSwitchingWorkspace,
  tasks,
  runs,
  sessions,
  onOpenDetails,
  onDelegate,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onHumanApprove,
  onHumanRequestChanges,
}: UseKanbanBoardModelArgs): KanbanPageContentModel {
  const columns = useMemo(() => mapToKanbanColumns(tasks), [tasks]);

  const runStateByTaskId = useMemo(
    () => new Map(runs.map((run) => [run.taskId, run.state])),
    [runs],
  );

  const activeSessionsByTaskId = useMemo(() => {
    const sessionsByTaskId = new Map<string, AgentSessionState[]>();
    for (const session of sessions) {
      if (!ACTIVE_SESSION_STATUS.has(session.status)) {
        continue;
      }

      const existing = sessionsByTaskId.get(session.taskId);
      if (existing) {
        existing.push(session);
      } else {
        sessionsByTaskId.set(session.taskId, [session]);
      }
    }

    for (const taskSessions of sessionsByTaskId.values()) {
      taskSessions.sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "running" ? -1 : 1;
        }
        return right.startedAt.localeCompare(left.startedAt);
      });
    }

    return sessionsByTaskId;
  }, [sessions]);

  return {
    isLoadingTasks,
    isSwitchingWorkspace,
    columns,
    runStateByTaskId,
    activeSessionsByTaskId,
    onOpenDetails,
    onDelegate,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanApprove,
    onHumanRequestChanges,
  };
}
