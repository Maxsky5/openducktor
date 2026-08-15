import {
  type AgentRuntimes,
  knownRuntimeKindValues,
  type RuntimeExecutableCheckResult,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { RuntimeExecutableValidationResult } from "@/state/queries/use-runtime-executable-validation";

export const runtimeExecutableResultForPath = (
  kind: RuntimeKind,
  executablePath: string,
  results: RuntimeExecutableValidationResult[],
): RuntimeExecutableValidationResult | undefined =>
  results.find((result) => result.kind === kind && result.requestedPath === executablePath);

export const invalidEnabledRuntime = (
  runtimes: AgentRuntimes,
  results: RuntimeExecutableValidationResult[],
): RuntimeExecutableCheckResult | null => {
  for (const kind of knownRuntimeKindValues) {
    if (!runtimes[kind].enabled) continue;
    const result = runtimeExecutableResultForPath(kind, runtimes[kind].executablePath, results);
    if (result?.ok === true) continue;
    return (
      result ?? {
        kind,
        path: runtimes[kind].executablePath,
        ok: false,
        version: null,
        error: `${kind} needs a valid executable path.`,
      }
    );
  }
  return null;
};
