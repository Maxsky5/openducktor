import {
  type DevServerGroupState,
  type DevServerScriptState,
  type DevServerTerminalChunk,
  devServerGroupStateSchema,
  type RepoConfig,
} from "@openducktor/contracts";
import type { DevServerProcessHandle } from "../../ports/dev-server-process-port";

export type DevServerGroupRuntime = {
  processes: Map<string, DevServerProcessHandle>;
  state: DevServerGroupState;
};

export const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
export const DEV_SERVER_COLORTERM = "truecolor";
export const DEV_SERVER_CLICOLOR_FORCE = "1";
export const DEV_SERVER_FORCE_COLOR = "1";
export const DEV_SERVER_TERM = "xterm-256color";

const TERMINAL_BUFFER_CHUNK_LIMIT = 2_000;
const TERMINAL_BUFFER_BYTE_LIMIT = 512 * 1024;

const nowIso = (): string => new Date().toISOString();

const scriptStateFromConfig = (script: RepoConfig["devServers"][number]): DevServerScriptState => ({
  scriptId: script.id,
  name: script.name,
  command: script.command,
  status: "stopped",
  pid: null,
  startedAt: null,
  exitCode: null,
  lastError: null,
  bufferedTerminalChunks: [],
});

export const scriptHasLiveProcess = (script: DevServerScriptState): boolean => script.pid !== null;

export const buildGroupState = (
  repoConfig: RepoConfig,
  taskId: string,
  worktreePath: string | null,
  updatedAt: string,
): DevServerGroupState =>
  devServerGroupStateSchema.parse({
    repoPath: repoConfig.repoPath,
    taskId,
    worktreePath,
    scripts: repoConfig.devServers.map(scriptStateFromConfig),
    updatedAt,
  });

export const syncGroupState = (
  state: DevServerGroupState,
  repoConfig: RepoConfig,
  taskId: string,
  worktreePath: string | null,
): void => {
  const existing = new Map(state.scripts.map((script) => [script.scriptId, script]));
  const nextScripts = repoConfig.devServers.map((script) => {
    const existingScript = existing.get(script.id);
    existing.delete(script.id);
    if (!existingScript) {
      return scriptStateFromConfig(script);
    }

    return {
      ...existingScript,
      command: script.command,
      name: script.name,
    };
  });
  nextScripts.push(...Array.from(existing.values()).filter(scriptHasLiveProcess));

  state.repoPath = repoConfig.repoPath;
  state.taskId = taskId;
  state.worktreePath = worktreePath;
  state.scripts = nextScripts;
  state.updatedAt = nowIso();
};

export const nextTerminalSequence = (script: DevServerScriptState): number => {
  const lastChunk = script.bufferedTerminalChunks.at(-1);
  return lastChunk ? lastChunk.sequence + 1 : 0;
};

export const trimTerminalChunks = (chunks: DevServerTerminalChunk[]): void => {
  let removeCount = 0;
  let totalBytes = chunks.reduce((total, chunk) => total + chunk.data.length, 0);

  while (
    chunks.length - removeCount > TERMINAL_BUFFER_CHUNK_LIMIT ||
    totalBytes > TERMINAL_BUFFER_BYTE_LIMIT
  ) {
    const chunk = chunks.at(removeCount);
    if (!chunk) {
      break;
    }
    totalBytes -= chunk.data.length;
    removeCount += 1;
  }

  if (removeCount > 0) {
    chunks.splice(0, removeCount);
  }
};

export const formatTerminalSystemMessage = (message: string): string => {
  const normalized = message.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
  return normalized.endsWith("\r\n") ? normalized : `${normalized}\r\n`;
};

export const formatTerminalProcessOutput = (data: string): string =>
  data.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
