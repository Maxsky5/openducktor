import type { ManagedMcpServer, ManagedMcpServerResolver } from "@openducktor/core";

/**
 * Per-thread config overrides. Codex applies the map in no fixed order, so every key is an
 * independent leaf. Do not add a parent table such as `mcp_servers.openducktor` next to them.
 */
export type CodexThreadConfig = {
  "mcp_servers.openducktor.command": string;
  "mcp_servers.openducktor.args": string[];
  "mcp_servers.openducktor.env": Record<string, string>;
  "mcp_servers.openducktor.enabled": true;
  "mcp_servers.openducktor.required": true;
  "mcp_servers.openducktor.default_tools_approval_mode": "prompt";
  "mcp_servers.openducktor.enabled_tools": string[];
};

export const resolveCodexThreadConfig = async (
  resolveManagedMcpServer: ManagedMcpServerResolver,
  repoPath: string,
  enabledTools: readonly string[],
): Promise<CodexThreadConfig> => {
  let server: ManagedMcpServer;
  try {
    server = await resolveManagedMcpServer(repoPath);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Cannot configure OpenDucktor workflow tools for repository '${repoPath}': ${reason}`,
      { cause },
    );
  }
  const [command, ...args] = server.command;
  return {
    "mcp_servers.openducktor.command": command,
    "mcp_servers.openducktor.args": args,
    "mcp_servers.openducktor.env": { ...server.environment },
    "mcp_servers.openducktor.enabled": true,
    "mcp_servers.openducktor.required": true,
    "mcp_servers.openducktor.default_tools_approval_mode": "prompt",
    "mcp_servers.openducktor.enabled_tools": [...enabledTools],
  };
};
