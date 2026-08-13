import type {
  AgentRuntimes,
  RuntimeDescriptor,
  RuntimeExecutableCheck,
  RuntimeKind,
} from "@openducktor/contracts";
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
  discovery: () => [...runtimeQueryKeys.all, "executables", "discovery"] as const,
  executables: (paths: Record<RuntimeKind, string>) =>
    [...runtimeQueryKeys.all, "executables", paths] as const,
};

export const runtimeDefinitionsQueryOptions = () =>
  queryOptions({
    queryKey: runtimeQueryKeys.definitions(),
    queryFn: async () => requireCompatibleRuntimeDefinitions(await host.runtimeDefinitionsList()),
    staleTime: RUNTIME_DEFINITIONS_STALE_TIME_MS,
  });

export const runtimeExecutablePaths = (runtimes: AgentRuntimes): Record<RuntimeKind, string> => ({
  opencode: runtimes.opencode.executablePath,
  codex: runtimes.codex.executablePath,
  claude: runtimes.claude.executablePath,
});

export const runtimeDiscoveryQueryOptions = () =>
  queryOptions({
    queryKey: runtimeQueryKeys.discovery(),
    queryFn: (): Promise<RuntimeExecutableCheck> =>
      host.runtimeExecutablesCheck({ mode: "discover" }),
    staleTime: 0,
  });

export const runtimeExecutablesQueryOptions = (paths: Record<RuntimeKind, string>) =>
  queryOptions({
    queryKey: runtimeQueryKeys.executables(paths),
    queryFn: (): Promise<RuntimeExecutableCheck> =>
      host.runtimeExecutablesCheck({ mode: "validate", paths }),
    staleTime: 30_000,
  });
