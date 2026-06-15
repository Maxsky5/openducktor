import type { AgentRole } from "@openducktor/core";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  type AgentStudioSelectionIntent,
  isSelectionIntentResolved,
} from "./agent-studio-selection-intent";

type UseAgentStudioSelectionIntentStateArgs = {
  isRepoNavigationBoundaryPending: boolean;
  taskIdParam: string;
  sessionKeyParam: string | null;
  roleFromQuery: AgentRole;
};

export type AgentStudioSelectionIntentState = {
  selectionIntentForController: AgentStudioSelectionIntent | null;
  scheduleSelectionIntent: (intent: AgentStudioSelectionIntent) => void;
};

type SelectionIntentResolutionState =
  | { kind: "idle" }
  | { kind: "pending"; intent: AgentStudioSelectionIntent }
  | { kind: "resolved"; intent: AgentStudioSelectionIntent };

const idleSelectionIntentState: SelectionIntentResolutionState = { kind: "idle" };

export function useAgentStudioSelectionIntentState({
  isRepoNavigationBoundaryPending,
  taskIdParam,
  sessionKeyParam,
  roleFromQuery,
}: UseAgentStudioSelectionIntentStateArgs): AgentStudioSelectionIntentState {
  const [intentState, setIntentState] =
    useState<SelectionIntentResolutionState>(idleSelectionIntentState);

  const scheduleSelectionIntent = useCallback(
    (intent: AgentStudioSelectionIntent): void => {
      const isResolved = isSelectionIntentResolved({
        selectionIntent: intent,
        taskIdParam,
        sessionKeyParam,
        roleFromQuery,
      });
      setIntentState({ kind: isResolved ? "resolved" : "pending", intent });
    },
    [roleFromQuery, sessionKeyParam, taskIdParam],
  );

  const currentIntent = intentState.kind === "idle" ? null : intentState.intent;
  const currentIntentResolved = currentIntent
    ? isSelectionIntentResolved({
        selectionIntent: currentIntent,
        taskIdParam,
        sessionKeyParam,
        roleFromQuery,
      })
    : false;

  useLayoutEffect(() => {
    setIntentState((current) => {
      if (current.kind === "idle") {
        return current;
      }
      if (isRepoNavigationBoundaryPending) {
        return idleSelectionIntentState;
      }

      const isResolved = isSelectionIntentResolved({
        selectionIntent: current.intent,
        taskIdParam,
        sessionKeyParam,
        roleFromQuery,
      });
      if (current.kind === "pending") {
        return isResolved ? { kind: "resolved", intent: current.intent } : current;
      }
      return isResolved ? current : idleSelectionIntentState;
    });
  }, [isRepoNavigationBoundaryPending, roleFromQuery, sessionKeyParam, taskIdParam]);

  const selectionIntentForController =
    !isRepoNavigationBoundaryPending &&
    (intentState.kind === "pending" || (intentState.kind === "resolved" && currentIntentResolved))
      ? intentState.intent
      : null;

  return {
    selectionIntentForController,
    scheduleSelectionIntent,
  };
}
