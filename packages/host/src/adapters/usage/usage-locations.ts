import path from "node:path";

/** The native history folders of each runtime. */
export type UsageLocations = {
  /** The Claude Code `projects` folder. */
  claude: string;
  /** The Codex `sessions` and `archived_sessions` folders. */
  codex: readonly string[];
  /** The OpenCode data folder, and the database file when `OPENCODE_DB` names one. */
  opencode: { directory: string; databaseFile: string | null };
  /** The Antigravity CLI conversation folder. The CLI reads no variable that moves it. */
  antigravity: string;
};

const setting = (env: NodeJS.ProcessEnv, name: string): string | null => {
  const value = env[name]?.trim();
  return value ? value : null;
};

/**
 * The native history folders of each runtime, with the variables that each runtime reads:
 * `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and for OpenCode `XDG_DATA_HOME` and `OPENCODE_DB`.
 */
export const resolveUsageLocations = (env: NodeJS.ProcessEnv, homeDir: string): UsageLocations => {
  const claudeHome = setting(env, "CLAUDE_CONFIG_DIR") ?? path.join(homeDir, ".claude");
  const codexHome = setting(env, "CODEX_HOME") ?? path.join(homeDir, ".codex");
  const dataHome = setting(env, "XDG_DATA_HOME") ?? path.join(homeDir, ".local", "share");
  const openCodeDirectory = path.join(dataHome, "opencode");
  const openCodeDatabase = setting(env, "OPENCODE_DB");
  return {
    claude: path.join(claudeHome, "projects"),
    codex: [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")],
    opencode: {
      directory: openCodeDirectory,
      // An in-memory database keeps no history. The data folder can still hold earlier files.
      databaseFile:
        openCodeDatabase === null || openCodeDatabase === ":memory:"
          ? null
          : path.resolve(openCodeDirectory, openCodeDatabase),
    },
    antigravity: path.join(homeDir, ".gemini", "antigravity-cli", "conversations"),
  };
};
