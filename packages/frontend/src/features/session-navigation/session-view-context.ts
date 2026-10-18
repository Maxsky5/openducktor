import { createContext, useContext } from "react";

export const SessionViewContext = createContext<{
  id: string;
  isActive: boolean;
} | null>(null);

export function useSessionViewActive(): boolean {
  return useContext(SessionViewContext)?.isActive ?? true;
}
