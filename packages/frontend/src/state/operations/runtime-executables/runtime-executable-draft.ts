import {
  type AgentRuntimes,
  knownRuntimeKindValues,
  type RuntimeExecutableCheckResult,
  type RuntimeKind,
} from "@openducktor/contracts";

export const replaceRuntimeExecutablePaths = (
  runtimes: AgentRuntimes,
  results: RuntimeExecutableCheckResult[],
): AgentRuntimes => {
  const resultsByKind = new Map<RuntimeKind, RuntimeExecutableCheckResult>(
    results.map((result) => [result.kind, result]),
  );
  let next = runtimes;

  for (const kind of knownRuntimeKindValues) {
    const executablePath = resultsByKind.get(kind)?.path ?? "";
    if (next[kind].executablePath === executablePath) continue;
    next = {
      ...next,
      [kind]: { ...next[kind], executablePath },
    };
  }

  return next;
};
