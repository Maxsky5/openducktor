import type { RuntimeExecutableProbesByKind } from "../../ports/runtime-executable-probe-port";
import { createClaudeExecutableProbe } from "../claude/claude-executable-probe";
import { createCodexExecutableProbe } from "../codex/codex-executable-probe";
import { createOpenCodeExecutableProbe } from "../opencode/opencode-executable-probe";

export const createRuntimeExecutableProbes = ({
  clientVersion,
  processEnv,
}: {
  clientVersion?: string;
  processEnv?: NodeJS.ProcessEnv;
} = {}): RuntimeExecutableProbesByKind => {
  const codexInput: Parameters<typeof createCodexExecutableProbe>[0] = {};
  if (clientVersion) {
    codexInput.clientVersion = clientVersion;
  }
  if (processEnv) {
    codexInput.processEnv = processEnv;
  }
  return {
    claude: createClaudeExecutableProbe(processEnv ? { processEnv } : {}),
    codex: createCodexExecutableProbe(codexInput),
    opencode: createOpenCodeExecutableProbe(processEnv ? { processEnv } : {}),
  };
};
