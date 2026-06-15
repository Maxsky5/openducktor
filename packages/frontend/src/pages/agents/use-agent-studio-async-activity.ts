import type { AgentRole } from "@openducktor/core";
import { useCallback, useRef, useState } from "react";
import {
  type AgentSessionIdentityLike,
  agentSessionIdentityKey,
} from "@/lib/agent-session-identity";
import type { ActiveWorkspace } from "@/types/state-slices";

type ActivityCountByKey = Record<string, number>;

type AgentStudioAsyncActivityHandle = {
  add: (key: string) => void;
  finish: () => void;
};

export type AgentStudioAsyncActivityTracker = {
  isActive: (key: string) => boolean;
  hasInFlight: (key: string) => boolean;
  begin: (key: string) => AgentStudioAsyncActivityHandle;
};

export type AgentStudioSessionActivityKeyParams = {
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  role: AgentRole;
  session: AgentSessionIdentityLike | null | undefined;
};

const incrementActivityCount = (current: ActivityCountByKey, key: string): ActivityCountByKey => ({
  ...current,
  [key]: (current[key] ?? 0) + 1,
});

const decrementActivityCount = (current: ActivityCountByKey, key: string): ActivityCountByKey => {
  const currentCount = current[key];
  if (!currentCount) {
    return current;
  }

  if (currentCount === 1) {
    const next = { ...current };
    delete next[key];
    return next;
  }

  return {
    ...current,
    [key]: currentCount - 1,
  };
};

export const useAgentStudioAsyncActivityTracker = (): AgentStudioAsyncActivityTracker => {
  const [activeCountByKey, setActiveCountByKey] = useState<ActivityCountByKey>({});
  const inFlightKeysRef = useRef<Set<string>>(new Set());

  const isActive = useCallback(
    (key: string): boolean => (activeCountByKey[key] ?? 0) > 0,
    [activeCountByKey],
  );
  const hasInFlight = useCallback((key: string): boolean => inFlightKeysRef.current.has(key), []);

  const begin = useCallback((key: string): AgentStudioAsyncActivityHandle => {
    const trackedKeys = new Set<string>();
    let finished = false;

    const add = (key: string): void => {
      if (finished || trackedKeys.has(key)) {
        return;
      }

      trackedKeys.add(key);
      inFlightKeysRef.current.add(key);
      setActiveCountByKey((current) => incrementActivityCount(current, key));
    };

    add(key);

    return {
      add,
      finish: (): void => {
        if (finished) {
          return;
        }

        finished = true;
        for (const key of trackedKeys) {
          inFlightKeysRef.current.delete(key);
        }
        setActiveCountByKey((current) => {
          let next = current;
          for (const key of trackedKeys) {
            next = decrementActivityCount(next, key);
          }
          return next;
        });
      },
    };
  }, []);

  return {
    isActive,
    hasInFlight,
    begin,
  };
};

export const buildAgentStudioSessionActivityKey = (
  params: AgentStudioSessionActivityKeyParams,
): string => {
  const workspaceId = params.activeWorkspace?.workspaceId ?? "__no_workspace__";
  const sessionKey = params.session ? agentSessionIdentityKey(params.session) : "__draft__";
  return `${workspaceId}:${params.taskId}:${params.role}:${sessionKey}`;
};
