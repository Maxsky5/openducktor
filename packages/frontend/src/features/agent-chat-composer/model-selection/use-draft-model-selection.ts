import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useState } from "react";
import { isSameSelection } from "@/features/session-start";
import type { RepoSettingsInput } from "@/types/state-slices";
import { resolveDraftModelSelection } from "./model-selection-preferences";

const emptyDraftSelections = (): Record<AgentRole, AgentModelSelection | null> => ({
  spec: null,
  planner: null,
  build: null,
  qa: null,
});

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
  const [draftWorkspaceRepoPath, setDraftWorkspaceRepoPath] = useState<string | null>(
    workspaceRepoPath,
  );
  const [defaultsWorkspaceRepoPath, setDefaultsWorkspaceRepoPath] = useState<string | null>(
    workspaceRepoPath,
  );
  const [
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    setIsAwaitingRepoSettingsForWorkspaceRepoPath,
  ] = useState(false);
  const [draftSelectionByRole, setDraftSelectionByRole] =
    useState<Record<AgentRole, AgentModelSelection | null>>(emptyDraftSelections);
  const [draftSelectionTouchedByRole, setDraftSelectionTouchedByRole] = useState<
    Record<AgentRole, boolean>
  >(emptyDraftSelectionTouchedByRole);

  const hasDraftSelectionForWorkspaceRepoPath = draftWorkspaceRepoPath === workspaceRepoPath;

  if (!hasDraftSelectionForWorkspaceRepoPath) {
    setDraftWorkspaceRepoPath(workspaceRepoPath);
    setDraftSelectionByRole(emptyDraftSelections());
    setDraftSelectionTouchedByRole(emptyDraftSelectionTouchedByRole());
  }

  if (defaultsWorkspaceRepoPath !== workspaceRepoPath) {
    setDefaultsWorkspaceRepoPath(workspaceRepoPath);
    setIsAwaitingRepoSettingsForWorkspaceRepoPath(
      Boolean(workspaceRepoPath) && repoSettings == null,
    );
  } else if (isAwaitingRepoSettingsForWorkspaceRepoPath && repoSettings != null) {
    setIsAwaitingRepoSettingsForWorkspaceRepoPath(false);
  }

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
