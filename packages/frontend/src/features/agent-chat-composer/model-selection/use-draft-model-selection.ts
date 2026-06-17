import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useMemo, useReducer } from "react";
import { isSameSelection } from "@/features/session-start";
import type { RepoSettingsInput } from "@/types/state-slices";
import { resolvePreferredModelSelection } from "./model-selection-preferences";

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

type DraftModelSelectionContext = {
  workspaceRepoPath: string | null;
};

type DraftModelSelectionInit = {
  context: DraftModelSelectionContext;
  repoSettingsReady: boolean;
};

type DraftModelSelectionState = {
  context: DraftModelSelectionContext;
  isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
  draftSelectionByRole: Record<AgentRole, AgentModelSelection | null>;
  draftSelectionTouchedByRole: Record<AgentRole, boolean>;
};

type DraftModelSelectionAction =
  | {
      type: "draftSelectionApplied";
      context: DraftModelSelectionContext;
      repoSettingsReady: boolean;
      role: AgentRole;
      selection: AgentModelSelection | null;
    }
  | {
      type: "draftSelectionSynced";
      composerCatalog: AgentModelCatalog | null;
      context: DraftModelSelectionContext;
      hasSessionTarget: boolean;
      repoSettingsReady: boolean;
      role: AgentRole;
      roleDefaultSelection: AgentModelSelection | null;
    };

const createDraftModelSelectionState = ({
  context,
  repoSettingsReady,
}: DraftModelSelectionInit): DraftModelSelectionState => ({
  context,
  isAwaitingRepoSettingsForWorkspaceRepoPath:
    Boolean(context.workspaceRepoPath) && !repoSettingsReady,
  draftSelectionByRole: emptyDraftSelections(),
  draftSelectionTouchedByRole: emptyDraftSelectionTouchedByRole(),
});

const getDraftModelSelectionStateForContext = (
  state: DraftModelSelectionState,
  context: DraftModelSelectionContext,
  repoSettingsReady: boolean,
): DraftModelSelectionState => {
  if (state.context !== context) {
    return createDraftModelSelectionState({ context, repoSettingsReady });
  }

  if (state.isAwaitingRepoSettingsForWorkspaceRepoPath && repoSettingsReady) {
    return {
      ...state,
      isAwaitingRepoSettingsForWorkspaceRepoPath: false,
    };
  }

  return state;
};

const draftModelSelectionReducer = (
  state: DraftModelSelectionState,
  action: DraftModelSelectionAction,
): DraftModelSelectionState => {
  const currentState = getDraftModelSelectionStateForContext(
    state,
    action.context,
    action.repoSettingsReady,
  );

  switch (action.type) {
    case "draftSelectionApplied":
      return {
        ...currentState,
        draftSelectionByRole: {
          ...currentState.draftSelectionByRole,
          [action.role]: action.selection,
        },
        draftSelectionTouchedByRole: {
          ...currentState.draftSelectionTouchedByRole,
          [action.role]: true,
        },
      };
    case "draftSelectionSynced": {
      if (action.hasSessionTarget || !action.composerCatalog) {
        return currentState;
      }

      const existing = currentState.draftSelectionByRole[action.role];
      const normalized = resolvePreferredModelSelection({
        catalog: action.composerCatalog,
        preferredSelection: currentState.draftSelectionTouchedByRole[action.role] ? existing : null,
        fallbackSelection: action.roleDefaultSelection,
      });
      return isSameSelection(existing, normalized)
        ? currentState
        : {
            ...currentState,
            draftSelectionByRole: {
              ...currentState.draftSelectionByRole,
              [action.role]: normalized,
            },
          };
    }
  }
};

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
  syncDraftSelection: (input: {
    hasSessionTarget: boolean;
    composerCatalog: AgentModelCatalog | null;
    roleDefaultSelection: AgentModelSelection | null;
  }) => void;
} => {
  const repoSettingsReady = repoSettings != null;
  const draftContext = useMemo<DraftModelSelectionContext>(
    () => ({ workspaceRepoPath }),
    [workspaceRepoPath],
  );
  const [draftState, dispatchDraftState] = useReducer(
    draftModelSelectionReducer,
    { context: draftContext, repoSettingsReady },
    createDraftModelSelectionState,
  );
  const currentDraftState = getDraftModelSelectionStateForContext(
    draftState,
    draftContext,
    repoSettingsReady,
  );

  const applyDraftSelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      dispatchDraftState({
        type: "draftSelectionApplied",
        context: draftContext,
        repoSettingsReady,
        role,
        selection,
      });
    },
    [draftContext, repoSettingsReady, role],
  );

  const syncDraftSelection = useCallback(
    ({
      hasSessionTarget,
      composerCatalog,
      roleDefaultSelection,
    }: {
      hasSessionTarget: boolean;
      composerCatalog: AgentModelCatalog | null;
      roleDefaultSelection: AgentModelSelection | null;
    }): void => {
      dispatchDraftState({
        type: "draftSelectionSynced",
        composerCatalog,
        context: draftContext,
        hasSessionTarget,
        repoSettingsReady,
        role,
        roleDefaultSelection,
      });
    },
    [draftContext, repoSettingsReady, role],
  );

  return {
    draftSelection: currentDraftState.draftSelectionByRole[role],
    isAwaitingRepoSettingsForWorkspaceRepoPath:
      currentDraftState.isAwaitingRepoSettingsForWorkspaceRepoPath,
    applyDraftSelection,
    syncDraftSelection,
  };
};
