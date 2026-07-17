import { HostValidationError } from "../../effect/host-errors";
import { OPENDUCKTOR_MCP_ENV_VAR_NAMES } from "../mcp/openducktor-mcp-environment";

const tomlString = (value: string): string =>
  value.includes("'") ? `'''${value}'''` : `'${value}'`;

const tomlStringArray = (values: readonly string[]): string =>
  `[${values.map((value) => tomlString(value)).join(", ")}]`;

export const buildCodexMcpConfigArgs = (mcpCommand: string[]): string[] => {
  const [mcpBinary, ...mcpArgs] = mcpCommand;
  if (!mcpBinary) {
    throw new HostValidationError({
      message: "OpenDucktor MCP command cannot be empty.",
      field: "mcpCommand",
    });
  }

  return [
    `mcp_servers.openducktor.command=${tomlString(mcpBinary)}`,
    `mcp_servers.openducktor.args=${tomlStringArray(mcpArgs)}`,
    `mcp_servers.openducktor.env_vars=${tomlStringArray(OPENDUCKTOR_MCP_ENV_VAR_NAMES)}`,
    `mcp_servers.openducktor.default_tools_approval_mode=${tomlString("prompt")}`,
    "mcp_servers.openducktor.enabled=true",
  ].flatMap((config) => ["--config", config]);
};
