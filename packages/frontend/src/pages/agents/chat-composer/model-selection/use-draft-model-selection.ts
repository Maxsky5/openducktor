import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoSettingsInput } from "@/types/state-slices";
import { emptyDraftSelections, isSameSelection } from "../../agents-page-selection";
import { resolveDraftModelSelection } from "./model-selection-preferences";

const emptyDraftSelectionTouchedByRole = (): Record<AgentRole, boolean> => ({
  spec: false,
  planner: false,
  build: false,
  qa: false,
});

export const useAgentStudioDraftModelSelectionState = ({
  workspaceRepoPath,
  repoSettings,
  role,
}: {
  workspaceRepoPath: string | null;
  repoSettings: RepoSettingsInput | null;
  role: AgentRole;
}): {
  draftSelection: AgentModelSelection | null;
  isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
  applyDraftSelection: (selection: AgentModelSelection | null) => void;
  repairDraftSelection: (input: {
    hasActiveSession: boolean;
    composerCatalog: AgentModelCatalog | null;
    roleDefaultSelection: AgentModelSelection | null;
  }) => void;
} => {
  const previousWorkspaceRepoPathRef = useRef<string | null>(workspaceRepoPath);
  const previousWorkspaceRepoPathForDefaultsRef = useRef<string | null>(workspaceRepoPath);
  const [
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    setIsAwaitingRepoSettingsForWorkspaceRepoPath,
  ] = useState(false);
  const [draftSelectionByRole, setDraftSelectionByRole] =
    useState<Record<AgentRole, AgentModelSelection | null>>(emptyDraftSelections);
  const [draftSelectionTouchedByRole, setDraftSelectionTouchedByRole] = useState<
    Record<AgentRole, boolean>
  >(emptyDraftSelectionTouchedByRole);

  useEffect(() => {
    if (previousWorkspaceRepoPathRef.current === workspaceRepoPath) {
      return;
    }
    previousWorkspaceRepoPathRef.current = workspaceRepoPath;
    setDraftSelectionByRole(emptyDraftSelections());
    setDraftSelectionTouchedByRole(emptyDraftSelectionTouchedByRole());
  }, [workspaceRepoPath]);

  useEffect(() => {
    if (previousWorkspaceRepoPathForDefaultsRef.current !== workspaceRepoPath) {
      previousWorkspaceRepoPathForDefaultsRef.current = workspaceRepoPath;
      setIsAwaitingRepoSettingsForWorkspaceRepoPath(
        Boolean(workspaceRepoPath) && repoSettings == null,
      );
      return;
    }
    if (isAwaitingRepoSettingsForWorkspaceRepoPath && repoSettings != null) {
      setIsAwaitingRepoSettingsForWorkspaceRepoPath(false);
    }
  }, [workspaceRepoPath, isAwaitingRepoSettingsForWorkspaceRepoPath, repoSettings]);

  const hasDraftSelectionForWorkspaceRepoPath =
    previousWorkspaceRepoPathRef.current === workspaceRepoPath;
  const isDraftSelectionTouched = hasDraftSelectionForWorkspaceRepoPath
    ? draftSelectionTouchedByRole[role]
    : false;

  const applyDraftSelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      setDraftSelectionByRole((current) => ({ ...current, [role]: selection }));
      setDraftSelectionTouchedByRole((current) => ({ ...current, [role]: true }));
    },
    [role],
  );

  const repairDraftSelection = useCallback(
    ({
      hasActiveSession,
      composerCatalog,
      roleDefaultSelection,
    }: {
      hasActiveSession: boolean;
      composerCatalog: AgentModelCatalog | null;
      roleDefaultSelection: AgentModelSelection | null;
    }): void => {
      if (hasActiveSession) {
        return;
      }
      if (!composerCatalog) {
        return;
      }
      setDraftSelectionByRole((current) => {
        const existing = current[role];
        const normalized = resolveDraftModelSelection({
          catalog: composerCatalog,
          existingSelection: isDraftSelectionTouched ? existing : null,
          roleDefaultSelection,
        });
        return isSameSelection(existing, normalized) ? current : { ...current, [role]: normalized };
      });
    },
    [isDraftSelectionTouched, role],
  );

  return {
    draftSelection: hasDraftSelectionForWorkspaceRepoPath ? draftSelectionByRole[role] : null,
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    applyDraftSelection,
    repairDraftSelection,
  };
};
