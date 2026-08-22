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
} = {}): RuntimeExecutableProbesByKind => ({
  claude: createClaudeExecutableProbe(processEnv ? { processEnv } : {}),
  codex: createCodexExecutableProbe({
    ...(clientVersion ? { clientVersion } : undefined),
    ...(processEnv ? { processEnv } : undefined),
  }),
  opencode: createOpenCodeExecutableProbe(processEnv ? { processEnv } : {}),
});
