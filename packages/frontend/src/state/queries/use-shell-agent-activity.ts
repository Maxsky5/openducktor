import { useMemo } from "react";
import type { AgentActivitySessionSummary } from "@/state/agent-sessions-store";
import {
  type AgentActivitySummary,
  type AgentActivityTaskTitleLookup,
  summarizeAgentActivity,
} from "@/state/read-models/agent-activity-read-model";
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
  activeWorkspaceRepoPath,
  workspaceRepoPath,
  sessions,
}: {
  activeWorkspaceRepoPath: string | null;
  workspaceRepoPath: string | null;
  sessions: AgentActivitySessionSummary[];
}): AgentActivitySessionSummary[] => {
  if (activeWorkspaceRepoPath === null) {
    return [];
  }

  return workspaceRepoPath === activeWorkspaceRepoPath ? sessions : [];
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
  activeWorkspaceRepoPath: string | null,
): AgentActivitySummary => {
  const activitySnapshot = useAgentActivitySnapshot();
  const { tasks } = useTasksState();
  const visibleSessions = useMemo(
    () =>
      selectVisibleActivitySessions({
        activeWorkspaceRepoPath,
        workspaceRepoPath: activitySnapshot.workspaceRepoPath,
        sessions: activitySnapshot.sessions,
      }),
    [activeWorkspaceRepoPath, activitySnapshot],
  );
  const activityTaskIds = useMemo(() => collectActivityTaskIds(visibleSessions), [visibleSessions]);
  const selectTaskTitles = useMemo(
    () => selectTaskTitlesForActivity(activityTaskIds),
    [activityTaskIds],
  );
  const taskTitleById = useMemo(() => selectTaskTitles(tasks), [selectTaskTitles, tasks]);

  return useMemo(() => {
    if (activeWorkspaceRepoPath === null || visibleSessions.length === 0) {
      return EMPTY_AGENT_ACTIVITY_SUMMARY;
    }

    return summarizeAgentActivity({
      sessions: visibleSessions,
      taskTitleById,
    });
  }, [activeWorkspaceRepoPath, taskTitleById, visibleSessions]);
};
