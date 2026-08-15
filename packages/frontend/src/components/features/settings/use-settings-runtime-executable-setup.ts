import type { AgentRuntimes } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { replaceRuntimeExecutablePaths } from "@/state/operations/runtime-executables/runtime-executable-draft";
import { runtimeDiscoveryQueryOptions } from "@/state/queries/runtime";
import {
  type RuntimeExecutableValidationState,
  useRuntimeExecutableValidation,
} from "@/state/queries/use-runtime-executable-validation";

type UpdateAgentRuntimes = (updater: (current: AgentRuntimes) => AgentRuntimes) => void;

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
      void queryClient.cancelQueries({
        queryKey: runtimeDiscoveryQueryOptions().queryKey,
        exact: true,
      });
    }
    return () => {
      if (visit.current === currentVisit) {
        visit.current += 1;
      }
    };
  }, [open, queryClient]);

  const checkAgain = useCallback(
    async (updateAgentRuntimes: UpdateAgentRuntimes): Promise<void> => {
      if (discoveryInFlight.current) return;

      const currentVisit = visit.current;
      discoveryInFlight.current = true;
      setIsCheckingDiscovery(true);
      try {
        const discovered = await queryClient.fetchQuery(runtimeDiscoveryQueryOptions());
        if (visit.current !== currentVisit) return;
        updateAgentRuntimes((current) =>
          replaceRuntimeExecutablePaths(current, discovered.runtimes),
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
    [queryClient],
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
