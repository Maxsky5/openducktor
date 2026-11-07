import { createContext, useContext } from "react";
import type { SettingsModalOpenRequest } from "./use-settings-modal-requests";

type SettingsModalContextValue = {
  openSettings(request?: SettingsModalOpenRequest): void;
};

export const SettingsModalContext = createContext<SettingsModalContextValue | null>(null);

export function useSettingsModal(): SettingsModalContextValue {
  const value = useContext(SettingsModalContext);
  if (!value) throw new Error("useSettingsModal must be used inside SettingsModalProvider.");
  return value;
}

/**
 * Closes the shared Settings to open another dialog in its place. Settings then moves no focus on
 * close, and `openDialog` gets the element that opened Settings for its own focus return.
 */
export type SettingsDialogHandoff = (openDialog: (returnFocus: HTMLElement | null) => void) => void;

export const SettingsDialogHandoffContext = createContext<SettingsDialogHandoff | null>(null);

/** Returns the handoff of the shared Settings, or `null` in a `SettingsModal` without a provider. */
export function useSettingsDialogHandoff(): SettingsDialogHandoff | null {
  return useContext(SettingsDialogHandoffContext);
}
