import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type AgentActivitySummary,
  type AgentActivityTaskTitleLookup,
  summarizeAgentActivity,
} from "@/components/layout/sidebar/agent-activity-model";
import type { AgentActivitySessionSummary } from "@/state/agent-sessions-store";
import { useAgentActivitySessions } from "../app-state-provider";
import { type RepoTaskData, repoTaskDataQueryOptions } from "./tasks";

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

const selectTaskTitlesForActivity = (taskIds: readonly string[]) => {
  if (taskIds.length === 0) {
    return (): AgentActivityTaskTitleLookup => EMPTY_TASK_TITLES;
  }

  const visibleTaskIds = new Set(taskIds);
  return (repoTaskData: RepoTaskData): AgentActivityTaskTitleLookup => {
    const taskTitleById: Record<string, string> = {};
    for (const task of repoTaskData.tasks) {
      if (!visibleTaskIds.has(task.id)) {
        continue;
      }
      taskTitleById[task.id] = task.title;
    }
    return taskTitleById;
  };
};

export const useShellAgentActivity = (activeRepo: string | null): AgentActivitySummary => {
  const sessions = useAgentActivitySessions();
  const activityTaskIds = useMemo(() => collectActivityTaskIds(sessions), [sessions]);
  const selectTaskTitles = useMemo(
    () => selectTaskTitlesForActivity(activityTaskIds),
    [activityTaskIds],
  );
  const taskTitleQuery = useQuery({
    ...repoTaskDataQueryOptions(activeRepo ?? "__shell-activity-disabled__"),
    enabled: activeRepo !== null && activityTaskIds.length > 0,
    select: selectTaskTitles,
  });
  const taskTitleById = taskTitleQuery.data ?? EMPTY_TASK_TITLES;

  return useMemo(() => {
    if (activeRepo === null || sessions.length === 0) {
      return EMPTY_AGENT_ACTIVITY_SUMMARY;
    }

    return summarizeAgentActivity({
      sessions,
      taskTitleById,
    });
  }, [activeRepo, sessions, taskTitleById]);
};
