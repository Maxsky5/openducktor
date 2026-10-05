/** Launch values of the managed OpenDucktor MCP server for one workspace. */
export type ManagedMcpServer = {
  readonly command: readonly [string, ...string[]];
  readonly environment: Readonly<Record<string, string>>;
};

/** Resolves the managed MCP server for the workspace that owns `repoPath`. */
export type ManagedMcpServerResolver = (repoPath: string) => Promise<ManagedMcpServer>;
