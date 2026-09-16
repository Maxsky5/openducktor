import { isClaudeInterruptedTurnResumeSupported } from "../../adapters/claude/claude-continuation-compatibility";
import {
  createRuntimeDefinitionsService,
  type RuntimeDefinitionsService,
} from "../../application/runtimes/runtime-definitions-service";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { SystemCommandPort } from "../../ports/system-command-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export const createHostRuntimeDefinitionsService = (input: {
  readonly claudeInterruptedTurnResumeEnabled: boolean;
  readonly settingsConfig: SettingsConfigPort;
  readonly toolDiscovery: ToolDiscoveryPort;
  readonly systemCommands: SystemCommandPort;
}): RuntimeDefinitionsService =>
  createRuntimeDefinitionsService({
    claudeInterruptedTurnResumeEnabled: input.claudeInterruptedTurnResumeEnabled,
    resolveClaudeInterruptedTurnResumeSupport: () =>
      isClaudeInterruptedTurnResumeSupported({
        settingsConfig: input.settingsConfig,
        toolDiscovery: input.toolDiscovery,
        systemCommands: input.systemCommands,
      }),
  });
