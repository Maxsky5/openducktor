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
