import { createContext, use, useEffect } from "react";
import type { StartupOutputReading } from "./startup-output-reading";

type StartupTraceState = {
  expanded: Readonly<Record<string, ReadonlySet<string>>>;
  scroll: Map<string, number>;
  notificationPresented: Set<string>;
  toggle(attemptId: string, stepId: string): void;
  outputReading(attemptId: string, terminalId: string): StartupOutputReading;
  sheetClosers: Map<string, () => void>;
};

export const StartupPresentationContext = createContext<StartupTraceState | null>(null);

export const useStartupPresentation = (): StartupTraceState => {
  const traceState = use(StartupPresentationContext);
  if (!traceState)
    throw new Error("Session startup presentation is missing from the connection tree.");
  return traceState;
};

/** Exact attempt ownership keeps an overlay action from closing another native sheet. */
export const useStartupSheetClose = (attemptId: string | null, close: () => void): void => {
  const { sheetClosers } = useStartupPresentation();
  useEffect(() => {
    if (!attemptId) return;
    sheetClosers.set(attemptId, close);
    return () => {
      if (sheetClosers.get(attemptId) === close) sheetClosers.delete(attemptId);
    };
  }, [attemptId, close, sheetClosers]);
};
