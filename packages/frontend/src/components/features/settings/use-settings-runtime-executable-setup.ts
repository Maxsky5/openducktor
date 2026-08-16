import { type AgentRuntimes, knownRuntimeKindValues } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { replaceRuntimeExecutablePaths } from "@/state/operations/runtime-executables/runtime-executable-draft";
import {
  runtimeDiscoveryQueryOptions,
  writeRuntimeExecutableValidationCache,
} from "@/state/queries/runtime";
import {
  type RuntimeExecutableValidationState,
  useRuntimeExecutableValidation,
} from "@/state/queries/use-runtime-executable-validation";

type UpdateAgentRuntimes = (updater: (current: AgentRuntimes) => AgentRuntimes) => void;

const replaceUneditedRuntimeExecutablePaths = (
  current: AgentRuntimes,
  pathsAtDiscoveryStart: AgentRuntimes,
  discovered: Parameters<typeof replaceRuntimeExecutablePaths>[1],
): AgentRuntimes => {
  let next = replaceRuntimeExecutablePaths(current, discovered);
  for (const kind of knownRuntimeKindValues) {
    if (current[kind].executablePath === pathsAtDiscoveryStart[kind].executablePath) continue;
    if (next[kind].executablePath === current[kind].executablePath) continue;
    next = {
      ...next,
      [kind]: { ...next[kind], executablePath: current[kind].executablePath },
    };
  }
  return next;
};

export type SettingsRuntimeExecutableSetup = {
  validation: RuntimeExecutableValidationState;
  isLoading: boolean;
  isCheckingDiscovery: boolean;
  discoveryError: string | null;
  error: string | null;
  checkAgain: (updateAgentRuntimes: UpdateAgentRuntimes) => Promise<void>;
};

export const useSettingsRuntimeExecutableSetup = ({
  open,
  runtimes,
}: {
  open: boolean;
  runtimes: AgentRuntimes | null;
}): SettingsRuntimeExecutableSetup => {
  const queryClient = useQueryClient();
  const validation = useRuntimeExecutableValidation(runtimes, open);
  const discoveryInFlight = useRef(false);
  const visit = useRef(0);
  const [isCheckingDiscovery, setIsCheckingDiscovery] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  useEffect(() => {
    const currentVisit = visit.current + 1;
    visit.current = currentVisit;
    if (!open) {
      discoveryInFlight.current = false;
      setIsCheckingDiscovery(false);
      setDiscoveryError(null);
    }
    return () => {
      if (visit.current === currentVisit) {
        visit.current += 1;
      }
    };
  }, [open]);

  const checkAgain = useCallback(
    async (updateAgentRuntimes: UpdateAgentRuntimes): Promise<void> => {
      if (discoveryInFlight.current || !runtimes) return;

      const currentVisit = visit.current;
      const pathsAtDiscoveryStart = runtimes;
      discoveryInFlight.current = true;
      setIsCheckingDiscovery(true);
      try {
        const discovered = await queryClient.fetchQuery(runtimeDiscoveryQueryOptions());
        if (visit.current !== currentVisit) return;
        writeRuntimeExecutableValidationCache(queryClient, discovered);
        updateAgentRuntimes((current) =>
          replaceUneditedRuntimeExecutablePaths(
            current,
            pathsAtDiscoveryStart,
            discovered.runtimes,
          ),
        );
        setDiscoveryError(null);
      } catch (cause) {
        if (visit.current === currentVisit) {
          setDiscoveryError(errorMessage(cause));
        }
      } finally {
        if (visit.current === currentVisit) {
          discoveryInFlight.current = false;
          setIsCheckingDiscovery(false);
        }
      }
    },
    [queryClient, runtimes],
  );

  const validationError = validation.error ? errorMessage(validation.error) : null;
  return {
    validation,
    isLoading:
      open &&
      runtimes !== null &&
      (validation.checkingRuntimeKinds.length > 0 || isCheckingDiscovery),
    isCheckingDiscovery,
    discoveryError,
    error: discoveryError ?? validationError,
    checkAgain,
  };
};
