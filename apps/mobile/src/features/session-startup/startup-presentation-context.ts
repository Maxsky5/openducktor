import { createContext, use, useEffect } from "react";
import type { StartupOutputReading } from "./startup-output-reading";

export type StartupPresentationState = {
  expanded: Readonly<Record<string, ReadonlySet<string>>>;
  inlineProgressOverride: Readonly<Record<string, boolean>>;
};

export type StartupPresentationActions = {
  scroll: Map<string, number>;
  notificationPresented: Set<string>;
  toggle(attemptId: string, stepId: string): void;
  setInlineProgressOpen(attemptId: string, open: boolean): void;
  outputReading(attemptId: string, terminalId: string): StartupOutputReading;
  sheetClosers: Map<string, () => void>;
};

export type StartupTraceState = StartupPresentationState & StartupPresentationActions;

export const StartupPresentationStateContext = createContext<StartupPresentationState | null>(null);
export const StartupPresentationActionsContext = createContext<StartupPresentationActions | null>(
  null,
);

export const useStartupPresentationActions = (): StartupPresentationActions => {
  const actions = use(StartupPresentationActionsContext);
  if (!actions)
    throw new Error("Session startup presentation is missing from the connection tree.");
  return actions;
};

export const useStartupPresentation = (): StartupTraceState => {
  const state = use(StartupPresentationStateContext);
  const actions = useStartupPresentationActions();
  if (!state) throw new Error("Session startup presentation is missing from the connection tree.");
  return { ...state, ...actions };
};

/** Exact attempt ownership keeps an overlay action from closing another native sheet. */
export const useStartupSheetClose = (attemptId: string | null, close: () => void): void => {
  const { sheetClosers } = useStartupPresentationActions();
  useEffect(() => {
    if (!attemptId) return;
    sheetClosers.set(attemptId, close);
    return () => {
      if (sheetClosers.get(attemptId) === close) sheetClosers.delete(attemptId);
    };
  }, [attemptId, close, sheetClosers]);
};
