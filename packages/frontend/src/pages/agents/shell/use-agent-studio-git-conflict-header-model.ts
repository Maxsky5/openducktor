import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentStudioHeaderModel } from "@/components/features/agents/agent-studio-header.types";
import type { GitConflict } from "@/features/agent-studio-git";
import {
  type AgentStudioQuickActionOption,
  withGitConflictQuickAction,
} from "../agent-studio-quick-actions";
import type { AgentStudioWorkflowHeaderModel } from "../agents-page-view-model";

/** Adds the git conflict quick action to the chat header while the git actions report a conflict. */
export function useAgentStudioGitConflictHeaderModel({
  headerModel,
  gitConflictQuickAction,
  gitConflict,
  resolveGitConflict,
  isPanelOpen,
}: {
  headerModel: AgentStudioWorkflowHeaderModel;
  gitConflictQuickAction: AgentStudioQuickActionOption | null;
  gitConflict: GitConflict | null;
  resolveGitConflict: () => Promise<void>;
  isPanelOpen: boolean;
}): AgentStudioHeaderModel {
  // Each git refresh can recreate the resolve action, so the header changes only when a conflict starts or ends.
  const latestResolveRef = useRef(resolveGitConflict);
  useLayoutEffect(() => {
    latestResolveRef.current = resolveGitConflict;
  }, [resolveGitConflict]);
  const onResolveGitConflictQuickAction = useCallback((): void => {
    void latestResolveRef.current();
  }, []);
  // Git data does not refresh while the right panel is closed, so its conflict can be stale then.
  const hasActiveGitConflict = isPanelOpen && gitConflict !== null;

  return useMemo(() => {
    // Without Builder there is no conflict action, so the header needs no handler.
    if (!hasActiveGitConflict || !gitConflictQuickAction) {
      return { ...headerModel, onResolveGitConflictQuickAction: null };
    }
    return {
      ...headerModel,
      ...withGitConflictQuickAction(headerModel.quickActions, gitConflictQuickAction),
      onResolveGitConflictQuickAction,
    };
  }, [gitConflictQuickAction, hasActiveGitConflict, headerModel, onResolveGitConflictQuickAction]);
}
