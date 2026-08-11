import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useCallback, useReducer } from "react";
import {
  createDraftModelSelectionState,
  draftModelSelectionReducer,
  getDraftModelSelectionStateForContext,
} from "./model-selection-state";

export const useDraftModelSelectionState = ({
  contextKey,
  isDefaultSelectionReady,
  selectionKey,
}: {
  contextKey: string | null;
  isDefaultSelectionReady: boolean;
  selectionKey: string;
}): {
  draftSelection: AgentModelSelection | null;
  isAwaitingDefaultSelection: boolean;
  applyDraftSelection: (selection: AgentModelSelection | null) => void;
  syncDraftSelection: (input: {
    catalog: AgentModelCatalog | null;
    defaultSelection: AgentModelSelection | null;
  }) => void;
} => {
  const [draftState, dispatchDraftState] = useReducer(
    draftModelSelectionReducer,
    { contextKey, isDefaultSelectionReady },
    createDraftModelSelectionState,
  );
  const currentDraftState = getDraftModelSelectionStateForContext(
    draftState,
    contextKey,
    isDefaultSelectionReady,
  );

  const applyDraftSelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      dispatchDraftState({
        type: "draftSelectionApplied",
        contextKey,
        isDefaultSelectionReady,
        selection,
        selectionKey,
      });
    },
    [contextKey, isDefaultSelectionReady, selectionKey],
  );

  const syncDraftSelection = useCallback(
    ({
      catalog,
      defaultSelection,
    }: {
      catalog: AgentModelCatalog | null;
      defaultSelection: AgentModelSelection | null;
    }): void => {
      dispatchDraftState({
        type: "draftSelectionSynced",
        catalog,
        contextKey,
        defaultSelection,
        isDefaultSelectionReady,
        selectionKey,
      });
    },
    [contextKey, isDefaultSelectionReady, selectionKey],
  );

  return {
    draftSelection: currentDraftState.draftSelections[selectionKey] ?? null,
    isAwaitingDefaultSelection: currentDraftState.isAwaitingDefaultSelection,
    applyDraftSelection,
    syncDraftSelection,
  };
};
