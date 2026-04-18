import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type AgentActivitySummary,
  type AgentActivityTaskTitleLookup,
  summarizeAgentActivity,
} from "@/components/layout/sidebar/agent-activity-model";
import type { AgentActivitySessionSummary } from "@/state/agent-sessions-store";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useAgentActivitySessions } from "../app-state-provider";
import { repoVisibleTasksQueryOptions } from "./tasks";

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

const filterSessionsForRepo = (
  sessions: AgentActivitySessionSummary[],
  activeWorkspace: ActiveWorkspace | null,
): AgentActivitySessionSummary[] => {
  if (activeWorkspace === null) {
    return [];
  }

  return sessions.filter((session) => session.repoPath === activeWorkspace.repoPath);
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
  const sessions = useAgentActivitySessions();
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const visibleSessions = useMemo(
    () => filterSessionsForRepo(sessions, activeWorkspace),
    [activeWorkspace, sessions],
  );
  const activityTaskIds = useMemo(() => collectActivityTaskIds(visibleSessions), [visibleSessions]);
  const selectTaskTitles = useMemo(
    () => selectTaskTitlesForActivity(activityTaskIds),
    [activityTaskIds],
  );
  const taskTitleQuery = useQuery({
    ...repoVisibleTasksQueryOptions(activeRepoPath ?? "__shell-activity-disabled__"),
    enabled: activeRepoPath !== null && activityTaskIds.length > 0,
    select: selectTaskTitles,
  });
  const taskTitleById = taskTitleQuery.data ?? EMPTY_TASK_TITLES;

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
