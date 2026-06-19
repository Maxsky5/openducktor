import type { RuntimeDescriptor } from "@openducktor/contracts";
import { buildDisabledRuntimeHealth } from "@/lib/repo-runtime-health";
import type { RepoRuntimeHealthMap } from "@/types/diagnostics";

export type BuildRepoRuntimeHealthInput = {
  checkedRuntimeHealthByRuntime: RepoRuntimeHealthMap;
  allRuntimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  isLoadingRuntimeDefinitions: boolean;
  runtimeDefinitionsError: string | null;
};

export const buildRepoRuntimeHealthByRuntime = ({
  checkedRuntimeHealthByRuntime,
  allRuntimeDefinitions,
  availableRuntimeDefinitions,
  isLoadingRuntimeDefinitions,
  runtimeDefinitionsError,
}: BuildRepoRuntimeHealthInput): RepoRuntimeHealthMap => {
  const runtimeHealthByRuntime = { ...checkedRuntimeHealthByRuntime };
  if (isLoadingRuntimeDefinitions || runtimeDefinitionsError) {
    return runtimeHealthByRuntime;
  }

  const availableRuntimeKinds = new Set(
    availableRuntimeDefinitions.map((definition) => definition.kind),
  );
  for (const definition of allRuntimeDefinitions) {
    if (!availableRuntimeKinds.has(definition.kind)) {
      runtimeHealthByRuntime[definition.kind] = buildDisabledRuntimeHealth(definition);
    }
  }

  return runtimeHealthByRuntime;
};
