import type {
  AgentRuntimes,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";

export const runtimeExecutableResultForPath = (
  kind: RuntimeKind,
  executablePath: string,
  results: RuntimeExecutableCheckResult[],
): RuntimeExecutableCheckResult | undefined =>
  results.find((result) => result.kind === kind && result.path === executablePath);

export const invalidEnabledRuntime = (
  runtimes: AgentRuntimes,
  results: RuntimeExecutableCheckResult[],
): RuntimeExecutableCheckResult | null => {
  for (const kind of ["opencode", "codex", "claude"] as const) {
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
