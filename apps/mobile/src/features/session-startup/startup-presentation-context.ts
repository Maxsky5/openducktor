import { createContext, use, useEffect } from "react";
import type { StartupOutputReading } from "./startup-output-reading";

type StartupPresentation = {
  expanded: Readonly<Record<string, ReadonlySet<string>>>;
  scroll: Map<string, number>;
  toggle(attemptId: string, stepId: string): void;
  outputReading(attemptId: string, terminalId: string): StartupOutputReading;
  sheetClosers: Map<string, () => void>;
};

export const StartupPresentationContext = createContext<StartupPresentation | null>(null);

export const useStartupPresentation = (): StartupPresentation => {
  const presentation = use(StartupPresentationContext);
  if (!presentation)
    throw new Error("Session startup presentation is missing from the connection tree.");
  return presentation;
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
