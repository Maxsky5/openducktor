import { isClaudeInterruptedTurnResumeSupported } from "../../adapters/claude/claude-continuation-compatibility";
import {
  createRuntimeDefinitionsService,
  type RuntimeDefinitionsService,
} from "../../application/runtimes/runtime-definitions-service";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import type { CreateNodeHostCommandRouterInput } from "./node-host-command-router-types";

export const createHostRuntimeDefinitionsService = (
  input: Pick<CreateNodeHostCommandRouterInput, "claudeInterruptedTurnResumeEnabled">,
  ports: Pick<NodeHostDefaultPorts, "settingsConfig" | "toolDiscovery" | "systemCommands">,
): RuntimeDefinitionsService =>
  createRuntimeDefinitionsService({
    claudeInterruptedTurnResumeEnabled: input.claudeInterruptedTurnResumeEnabled !== false,
    resolveClaudeInterruptedTurnResumeSupport: () =>
      isClaudeInterruptedTurnResumeSupported({
        settingsConfig: ports.settingsConfig,
        toolDiscovery: ports.toolDiscovery,
        systemCommands: ports.systemCommands,
      }),
  });
