import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";

export const CLAUDE_CODE_TOOL_ID = "claude" as const;

export const resolveClaudeCodeExecutablePath = (toolDiscovery: ToolDiscoveryPort) =>
  toolDiscovery.resolveToolPath(CLAUDE_CODE_TOOL_ID);
