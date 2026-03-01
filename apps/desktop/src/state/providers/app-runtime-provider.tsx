import { type PropsWithChildren, type ReactElement, useMemo, useState } from "react";
import { ActiveRepoContext, type ActiveRepoContextValue } from "../app-state-contexts";

export function AppRuntimeProvider({ children }: PropsWithChildren): ReactElement {
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const activeRepoValue = useMemo<ActiveRepoContextValue>(
    () => ({
      activeRepo,
      setActiveRepo,
    }),
    [activeRepo],
  );

  return (
    <ActiveRepoContext.Provider value={activeRepoValue}>{children}</ActiveRepoContext.Provider>
  );
}
