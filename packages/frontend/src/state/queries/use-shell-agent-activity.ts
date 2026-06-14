import { useMemo } from "react";
import type { AgentActivitySessionSummary } from "@/state/agent-sessions-store";
import {
  type AgentActivitySummary,
  type AgentActivityTaskTitleLookup,
  summarizeAgentActivity,
} from "@/state/read-models/agent-activity-read-model";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useAgentActivitySnapshot, useTasksState } from "../app-state-provider";

const EMPTY_AGENT_ACTIVITY_SUMMARY: AgentActivitySummary = {
  activeSessionCount: 0,
  waitingForInputCount: 0,
  activeSessions: [],
  waitingForInputSessions: [],
};

const EMPTY_TASK_TITLES: AgentActivityTaskTitleLookup = {};

const collectActivityTaskIds = (sessions: AgentActivitySessionSummary[]): string[] => {
  const taskIds = new Set<string>();
  for (const session of sessions) {
    taskIds.add(session.taskId);
  }
  return [...taskIds];
};

const selectVisibleActivitySessions = ({
  activeWorkspace,
  workspaceRepoPath,
  sessions,
}: {
  activeWorkspace: ActiveWorkspace | null;
  workspaceRepoPath: string | null;
  sessions: AgentActivitySessionSummary[];
}): AgentActivitySessionSummary[] => {
  if (activeWorkspace === null) {
    return [];
  }

  return workspaceRepoPath === activeWorkspace.repoPath ? sessions : [];
};

const selectTaskTitlesForActivity = (taskIds: readonly string[]) => {
  if (taskIds.length === 0) {
    return (): AgentActivityTaskTitleLookup => EMPTY_TASK_TITLES;
  }

  const visibleTaskIds = new Set(taskIds);
  return (tasks: ReadonlyArray<{ id: string; title: string }>): AgentActivityTaskTitleLookup => {
    const taskTitleById: Record<string, string> = {};
    for (const task of tasks) {
      if (!visibleTaskIds.has(task.id)) {
        continue;
      }
      taskTitleById[task.id] = task.title;
    }
    return taskTitleById;
  };
};

export const useShellAgentActivity = (
  activeWorkspace: ActiveWorkspace | null,
): AgentActivitySummary => {
  const activitySnapshot = useAgentActivitySnapshot();
  const { tasks } = useTasksState();
  const visibleSessions = useMemo(
    () =>
      selectVisibleActivitySessions({
        activeWorkspace,
        workspaceRepoPath: activitySnapshot.workspaceRepoPath,
        sessions: activitySnapshot.sessions,
      }),
    [activeWorkspace, activitySnapshot],
  );
  const activityTaskIds = useMemo(() => collectActivityTaskIds(visibleSessions), [visibleSessions]);
  const selectTaskTitles = useMemo(
    () => selectTaskTitlesForActivity(activityTaskIds),
    [activityTaskIds],
  );
  const taskTitleById = useMemo(() => selectTaskTitles(tasks), [selectTaskTitles, tasks]);

  return useMemo(() => {
    if (activeWorkspace === null || visibleSessions.length === 0) {
      return EMPTY_AGENT_ACTIVITY_SUMMARY;
    }

    return summarizeAgentActivity({
      sessions: visibleSessions,
      taskTitleById,
    });
  }, [activeWorkspace, taskTitleById, visibleSessions]);
};
