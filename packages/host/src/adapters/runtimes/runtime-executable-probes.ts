import type { RuntimeExecutableProbesByKind } from "../../ports/runtime-executable-probe-port";
import { createAntigravityExecutableProbe } from "../antigravity/antigravity-executable-probe";
import { createClaudeExecutableProbe } from "../claude/claude-executable-probe";
import { createCodexExecutableProbe } from "../codex/codex-executable-probe";
import { createOpenCodeExecutableProbe } from "../opencode/opencode-executable-probe";

export const createRuntimeExecutableProbes = ({
  clientVersion,
  readEnv,
}: {
  clientVersion?: string;
  readEnv: () => NodeJS.ProcessEnv;
}): RuntimeExecutableProbesByKind => {
  const codexInput: Parameters<typeof createCodexExecutableProbe>[0] = { readEnv };
  if (clientVersion) {
    codexInput.clientVersion = clientVersion;
  }
  return {
    antigravity: createAntigravityExecutableProbe(
      clientVersion ? { readEnv, clientVersion } : { readEnv },
    ),
    claude: createClaudeExecutableProbe({ readEnv }),
    codex: createCodexExecutableProbe(codexInput),
    opencode: createOpenCodeExecutableProbe({ readEnv }),
  };
};
