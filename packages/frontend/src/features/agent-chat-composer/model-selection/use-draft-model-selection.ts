import type { AgentModelSelection } from "@openducktor/core";
import { useCallback, useEffect, useReducer } from "react";

type DraftModelSelectionState = {
  contextKey: string | null;
  draftSelections: Partial<Record<string, AgentModelSelection | null>>;
};

type DraftModelSelectionAction =
  | {
      type: "contextChanged";
      contextKey: string | null;
    }
  | {
      type: "selectionApplied";
      contextKey: string | null;
      selection: AgentModelSelection | null;
      selectionKey: string;
    };

const createDraftModelSelectionState = ({
  contextKey,
}: {
  contextKey: string | null;
}): DraftModelSelectionState => ({
  contextKey,
  draftSelections: {},
});

const draftStateForContext = (
  state: DraftModelSelectionState,
  contextKey: string | null,
): DraftModelSelectionState => {
  if (state.contextKey !== contextKey) {
    return createDraftModelSelectionState({ contextKey });
  }
  return state;
};

const draftModelSelectionReducer = (
  state: DraftModelSelectionState,
  action: DraftModelSelectionAction,
): DraftModelSelectionState => {
  if (action.type === "contextChanged") {
    return draftStateForContext(state, action.contextKey);
  }
  const currentState = draftStateForContext(state, action.contextKey);
  return {
    ...currentState,
    draftSelections: {
      ...currentState.draftSelections,
      [action.selectionKey]: action.selection,
    },
  };
};

const resolveDraftSelectionBeforeCatalog = ({
  defaultSelection,
  hasStoredDraftSelection,
  isAwaitingDefaultSelection,
  storedDraftSelection,
}: {
  defaultSelection: AgentModelSelection | null;
  hasStoredDraftSelection: boolean;
  isAwaitingDefaultSelection: boolean;
  storedDraftSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  if (hasStoredDraftSelection) {
    return storedDraftSelection;
  }
  if (isAwaitingDefaultSelection) {
    return null;
  }
  return defaultSelection;
};

export const useDraftModelSelectionState = ({
  contextKey,
  defaultSelection,
  isDefaultSelectionReady,
  selectionKey,
}: {
  contextKey: string | null;
  defaultSelection: AgentModelSelection | null;
  isDefaultSelectionReady: boolean;
  selectionKey: string;
}) => {
  const [draftState, dispatchDraftState] = useReducer(
    draftModelSelectionReducer,
    { contextKey },
    createDraftModelSelectionState,
  );
  useEffect(() => {
    dispatchDraftState({ type: "contextChanged", contextKey });
  }, [contextKey]);
  const currentDraftState = draftStateForContext(draftState, contextKey);
  const storedDraftSelection = currentDraftState.draftSelections[selectionKey];
  const hasStoredDraftSelection = storedDraftSelection !== undefined;
  const isAwaitingDefaultSelection = Boolean(contextKey) && !isDefaultSelectionReady;
  const draftSelection = resolveDraftSelectionBeforeCatalog({
    defaultSelection,
    hasStoredDraftSelection,
    isAwaitingDefaultSelection,
    storedDraftSelection: storedDraftSelection ?? null,
  });

  const applyDraftSelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      dispatchDraftState({
        type: "selectionApplied",
        contextKey,
        selection,
        selectionKey,
      });
    },
    [contextKey, selectionKey],
  );

  return {
    draftSelection,
    applyDraftSelection,
  } satisfies {
    draftSelection: AgentModelSelection | null;
    applyDraftSelection: (selection: AgentModelSelection | null) => void;
  };
};
