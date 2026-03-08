import type { RuntimeDescriptor } from "@openducktor/contracts";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { errorMessage } from "@/lib/errors";
import {
  ActiveRepoContext,
  type ActiveRepoContextValue,
  RuntimeDefinitionsContext,
  type RuntimeDefinitionsContextValue,
} from "../app-state-contexts";
import { host } from "../operations/host";

export function AppRuntimeProvider({ children }: PropsWithChildren): ReactElement {
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [runtimeDefinitions, setRuntimeDefinitions] = useState<RuntimeDescriptor[]>([]);
  const [isLoadingRuntimeDefinitions, setIsLoadingRuntimeDefinitions] = useState(true);
  const [runtimeDefinitionsError, setRuntimeDefinitionsError] = useState<string | null>(null);

  const activeRepoValue = useMemo<ActiveRepoContextValue>(
    () => ({
      activeRepo,
      setActiveRepo,
    }),
    [activeRepo],
  );

  const refreshRuntimeDefinitions = useCallback(async (): Promise<RuntimeDescriptor[]> => {
    setIsLoadingRuntimeDefinitions(true);
    setRuntimeDefinitionsError(null);
    try {
      const nextDefinitions = await host.runtimeDefinitionsList();
      setRuntimeDefinitions(nextDefinitions);
      return nextDefinitions;
    } catch (error) {
      const message = errorMessage(error);
      setRuntimeDefinitions([]);
      setRuntimeDefinitionsError(message);
      throw error;
    } finally {
      setIsLoadingRuntimeDefinitions(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingRuntimeDefinitions(true);
    setRuntimeDefinitionsError(null);

    void host
      .runtimeDefinitionsList()
      .then((nextDefinitions) => {
        if (cancelled) {
          return;
        }
        setRuntimeDefinitions(nextDefinitions);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRuntimeDefinitions([]);
        setRuntimeDefinitionsError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRuntimeDefinitions(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const runtimeDefinitionsValue = useMemo<RuntimeDefinitionsContextValue>(
    () => ({
      runtimeDefinitions,
      isLoadingRuntimeDefinitions,
      runtimeDefinitionsError,
      refreshRuntimeDefinitions,
    }),
    [
      isLoadingRuntimeDefinitions,
      refreshRuntimeDefinitions,
      runtimeDefinitions,
      runtimeDefinitionsError,
    ],
  );

  return (
    <ActiveRepoContext.Provider value={activeRepoValue}>
      <RuntimeDefinitionsContext.Provider value={runtimeDefinitionsValue}>
        {children}
      </RuntimeDefinitionsContext.Provider>
    </ActiveRepoContext.Provider>
  );
}
