import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useMemo, useReducer, useRef } from "react";
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

type DraftModelSelectionContext = {
  token: string;
  workspaceRepoPath: string | null;
  repoSettingsReady: boolean;
};

type DraftModelSelectionState = {
  contextToken: string;
  workspaceRepoPath: string | null;
  isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
  draftSelectionByRole: Record<AgentRole, AgentModelSelection | null>;
  draftSelectionTouchedByRole: Record<AgentRole, boolean>;
};

type DraftModelSelectionAction =
  | {
      type: "draftSelectionApplied";
      context: DraftModelSelectionContext;
      role: AgentRole;
      selection: AgentModelSelection | null;
    }
  | {
      type: "draftSelectionRepaired";
      composerCatalog: AgentModelCatalog | null;
      context: DraftModelSelectionContext;
      hasActiveSession: boolean;
      role: AgentRole;
      roleDefaultSelection: AgentModelSelection | null;
    };

const createDraftModelSelectionState = ({
  repoSettingsReady,
  token,
  workspaceRepoPath,
}: DraftModelSelectionContext): DraftModelSelectionState => ({
  contextToken: token,
  workspaceRepoPath,
  isAwaitingRepoSettingsForWorkspaceRepoPath: Boolean(workspaceRepoPath) && !repoSettingsReady,
  draftSelectionByRole: emptyDraftSelections(),
  draftSelectionTouchedByRole: emptyDraftSelectionTouchedByRole(),
});

const getDraftModelSelectionStateForContext = (
  state: DraftModelSelectionState,
  context: DraftModelSelectionContext,
): DraftModelSelectionState => {
  if (state.contextToken !== context.token) {
    return createDraftModelSelectionState(context);
  }

  if (state.isAwaitingRepoSettingsForWorkspaceRepoPath && context.repoSettingsReady) {
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
  const currentState = getDraftModelSelectionStateForContext(state, action.context);

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
    case "draftSelectionRepaired": {
      if (action.hasActiveSession || !action.composerCatalog) {
        return currentState;
      }

      const existing = currentState.draftSelectionByRole[action.role];
      const normalized = resolveDraftModelSelection({
        catalog: action.composerCatalog,
        existingSelection: currentState.draftSelectionTouchedByRole[action.role] ? existing : null,
        roleDefaultSelection: action.roleDefaultSelection,
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
  repairDraftSelection: (input: {
    hasActiveSession: boolean;
    composerCatalog: AgentModelCatalog | null;
    roleDefaultSelection: AgentModelSelection | null;
  }) => void;
} => {
  const previousWorkspaceRepoPathRef = useRef(workspaceRepoPath);
  const workspaceContextVersionRef = useRef(0);
  if (previousWorkspaceRepoPathRef.current !== workspaceRepoPath) {
    previousWorkspaceRepoPathRef.current = workspaceRepoPath;
    workspaceContextVersionRef.current += 1;
  }

  const repoSettingsReady = repoSettings != null;
  const draftContext = useMemo<DraftModelSelectionContext>(
    () => ({
      token: `${workspaceRepoPath ?? ""}\0${workspaceContextVersionRef.current}`,
      workspaceRepoPath,
      repoSettingsReady,
    }),
    [repoSettingsReady, workspaceRepoPath],
  );
  const [draftState, dispatchDraftState] = useReducer(
    draftModelSelectionReducer,
    draftContext,
    createDraftModelSelectionState,
  );
  const currentDraftState = getDraftModelSelectionStateForContext(draftState, draftContext);

  const applyDraftSelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      dispatchDraftState({
        type: "draftSelectionApplied",
        context: draftContext,
        role,
        selection,
      });
    },
    [draftContext, role],
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
      dispatchDraftState({
        type: "draftSelectionRepaired",
        composerCatalog,
        context: draftContext,
        hasActiveSession,
        role,
        roleDefaultSelection,
      });
    },
    [draftContext, role],
  );

  return {
    draftSelection: currentDraftState.draftSelectionByRole[role],
    isAwaitingRepoSettingsForWorkspaceRepoPath:
      currentDraftState.isAwaitingRepoSettingsForWorkspaceRepoPath,
    applyDraftSelection,
    repairDraftSelection,
  };
};
