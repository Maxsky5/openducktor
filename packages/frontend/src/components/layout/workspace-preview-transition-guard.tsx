import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from "react";

type RequestTransition = (apply: () => void, cancel?: () => void) => void;
type GuardContext = {
  register: (guard: RequestTransition) => () => void;
  run: RequestTransition;
};

const context = createContext<GuardContext | null>(null);

export function WorkspacePreviewTransitionGuardProvider({ children }: { children: ReactNode }) {
  const activeGuard = useRef<RequestTransition | null>(null);
  const register = useCallback((guard: RequestTransition) => {
    activeGuard.current = guard;
    return () => {
      if (activeGuard.current === guard) activeGuard.current = null;
    };
  }, []);
  const run = useCallback<RequestTransition>((apply, cancel) => {
    if (activeGuard.current) activeGuard.current(apply, cancel);
    else apply();
  }, []);
  const value = useMemo(() => ({ register, run }), [register, run]);
  return <context.Provider value={value}>{children}</context.Provider>;
}

export function useWorkspacePreviewTransitionGuard(): GuardContext {
  const value = useContext(context);
  if (!value) throw new Error("Workspace preview transition guard provider is missing.");
  return value;
}
