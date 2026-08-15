import type {
  AgentRuntimes,
  RuntimeExecutableCheckResult,
  RuntimeKind,
} from "@openducktor/contracts";

const RUNTIME_KINDS = ["opencode", "codex", "claude"] as const;

export const replaceRuntimeExecutablePaths = (
  runtimes: AgentRuntimes,
  results: RuntimeExecutableCheckResult[],
): AgentRuntimes => {
  const resultsByKind = new Map<RuntimeKind, RuntimeExecutableCheckResult>(
    results.map((result) => [result.kind, result]),
  );
  let next = runtimes;

  for (const kind of RUNTIME_KINDS) {
    const executablePath = resultsByKind.get(kind)?.path ?? "";
    if (next[kind].executablePath === executablePath) continue;
    next = {
      ...next,
      [kind]: { ...next[kind], executablePath },
    };
  }

  return next;
};
