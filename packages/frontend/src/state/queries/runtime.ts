import type { RuntimeDescriptor } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { validateRuntimeDefinitionsForOpenDucktor } from "@/lib/agent-runtime";
import { host } from "../operations/host";

const RUNTIME_DEFINITIONS_STALE_TIME_MS = 30 * 60_000;

const requireCompatibleRuntimeDefinitions = (
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeDescriptor[] => {
  const validationErrors = validateRuntimeDefinitionsForOpenDucktor(runtimeDefinitions);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join("; "));
  }

  return runtimeDefinitions;
};

export const runtimeQueryKeys = {
  all: ["runtime"] as const,
  definitions: () => [...runtimeQueryKeys.all, "definitions"] as const,
};

export const runtimeDefinitionsQueryOptions = () =>
  queryOptions({
    queryKey: runtimeQueryKeys.definitions(),
    queryFn: async () => requireCompatibleRuntimeDefinitions(await host.runtimeDefinitionsList()),
    staleTime: RUNTIME_DEFINITIONS_STALE_TIME_MS,
  });
