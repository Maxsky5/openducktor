import {
  type DevServerEvent,
  type DevServerGroupState,
  type DevServerOwner,
  type DevServerScriptState,
  devServerEventSchema,
  devServerGroupStateSchema,
  type HostEventEnvelope,
  type RepoConfig,
} from "@openducktor/contracts";
import type { TerminalOutputSource } from "../../ports/terminal-output-source-port";
import type { DevServerProcessHandle } from "../../ports/dev-server-process-port";
import type { DevServerWorkspaceActivity } from "./dev-server-service-types";

export type DevServerGroupRuntime = {
  processes: Map<string, DevServerProcessHandle>;
  unresolvedStops: Set<string>;
  state: DevServerGroupState;
  terminalOutputs: Map<string, TerminalOutputSource>;
};

const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
export const DEV_SERVER_COLORTERM = "truecolor";
export const DEV_SERVER_CLICOLOR_FORCE = "1";
export const DEV_SERVER_FORCE_COLOR = "1";
export const DEV_SERVER_TERM = "xterm-256color";

export const createDevServerEventEnvelope = (event: DevServerEvent): HostEventEnvelope => ({
  channel: DEV_SERVER_EVENT_CHANNEL,
  payload: devServerEventSchema.parse(event),
});

export const nowIso = (): string => new Date().toISOString();

const scriptStateFromConfig = (script: RepoConfig["devServers"][number]): DevServerScriptState => ({
  scriptId: script.id,
  name: script.name,
  command: script.command,
  startedCommand: null,
  status: "stopped",
  pid: null,
  startedAt: null,
  exitCode: null,
  lastError: null,
  terminalId: null,
});

export const scriptHasLiveProcess = (script: DevServerScriptState): boolean => script.pid !== null;

export const inspectDevServerWorkspaceActivity = (
  groups: Map<string, Map<string, DevServerGroupRuntime>>,
  repoPath: string,
): DevServerWorkspaceActivity => {
  const repoGroups = groups.get(repoPath);
  if (!repoGroups) {
    return { activeOwners: [] };
  }
  const activeOwners: DevServerOwner[] = [];
  for (const runtime of repoGroups.values()) {
    const isActive =
      runtime.processes.size > 0 ||
      runtime.unresolvedStops.size > 0 ||
      runtime.state.scripts.some(
        (script) =>
          scriptHasLiveProcess(script) ||
          script.status === "starting" ||
          script.status === "running" ||
          script.status === "stopping",
      );
    if (isActive) {
      activeOwners.push(runtime.state.owner);
    }
  }
  return { activeOwners };
};

export const buildGroupState = (
  repoConfig: RepoConfig,
  owner: DevServerOwner,
  workingDirectory: string | null,
  updatedAt: string,
): DevServerGroupState =>
  devServerGroupStateSchema.parse({
    repoPath: repoConfig.repoPath,
    owner,
    workingDirectory,
    scripts: repoConfig.devServers.map(scriptStateFromConfig),
    revision: 0,
    updatedAt,
  });

export const syncGroupState = (
  state: DevServerGroupState,
  repoConfig: RepoConfig,
  owner: DevServerOwner,
  workingDirectory: string | null,
  unresolvedStops: ReadonlySet<string>,
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
  nextScripts.push(
    ...Array.from(existing.values()).filter(
      (script) =>
        scriptHasLiveProcess(script) ||
        unresolvedStops.has(script.scriptId) ||
        script.status === "starting" ||
        script.status === "stopping",
    ),
  );

  state.repoPath = repoConfig.repoPath;
  state.owner = owner;
  state.workingDirectory = workingDirectory;
  state.scripts = nextScripts;
  state.revision += 1;
  state.updatedAt = nowIso();
};

export const syncRuntimeTerminalSources = (runtime: DevServerGroupRuntime): void => {
  const activeScriptIds = new Set(runtime.state.scripts.map((script) => script.scriptId));
  for (const [scriptId, output] of runtime.terminalOutputs) {
    if (!activeScriptIds.has(scriptId)) {
      runtime.terminalOutputs.delete(scriptId);
      output.release();
    }
  }
};

export const formatTerminalSystemMessage = (message: string): string => {
  const normalized = message.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
  return normalized.endsWith("\r\n") ? normalized : `${normalized}\r\n`;
};
