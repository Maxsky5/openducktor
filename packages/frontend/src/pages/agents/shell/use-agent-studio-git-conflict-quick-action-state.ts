import { type RefObject, useCallback, useRef, useState } from "react";
import type { AgentStudioGitConflictQuickActionContext } from "../use-agents-page-right-panel-model";
import { gitConflictQuickActionContextsEqual } from "./git-conflict-quick-action-context";

export type AgentStudioGitConflictQuickActionState = {
  gitConflictQuickActionContext: AgentStudioGitConflictQuickActionContext | null;
  gitConflictQuickActionContextRef: RefObject<AgentStudioGitConflictQuickActionContext | null>;
  onGitConflictQuickActionContextChange: (
    context: AgentStudioGitConflictQuickActionContext | null,
  ) => void;
};

export function useAgentStudioGitConflictQuickActionState(): AgentStudioGitConflictQuickActionState {
  const [gitConflictQuickActionContext, setGitConflictQuickActionContext] =
    useState<AgentStudioGitConflictQuickActionContext | null>(null);
  const gitConflictQuickActionContextRef = useRef<AgentStudioGitConflictQuickActionContext | null>(
    null,
  );

  const onGitConflictQuickActionContextChange = useCallback(
    (context: AgentStudioGitConflictQuickActionContext | null): void => {
      gitConflictQuickActionContextRef.current = context;
      setGitConflictQuickActionContext((current) =>
        gitConflictQuickActionContextsEqual(current, context) ? current : context,
      );
    },
    [],
  );

  return {
    gitConflictQuickActionContext,
    gitConflictQuickActionContextRef,
    onGitConflictQuickActionContextChange,
  };
}
