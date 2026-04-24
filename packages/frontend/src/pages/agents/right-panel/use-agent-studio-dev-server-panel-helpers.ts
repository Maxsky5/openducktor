import type {
  DevServerEvent,
  DevServerGroupState,
  DevServerScriptState,
} from "@openducktor/contracts";
import { trimDevServerTerminalChunks } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import { isBrowserLiveControlEvent } from "@/lib/browser-live-control-events";

export type { BrowserLiveControlEvent as DevServerSubscriptionControlEvent } from "@/types";

export const buildTaskMemoryKey = (repoPath: string, taskId: string): string => {
  return `${repoPath}::${taskId}`;
};

const replaceScript = (
  scripts: DevServerScriptState[],
  nextScript: DevServerScriptState,
): DevServerScriptState[] => {
  return scripts.map((script) => (script.scriptId === nextScript.scriptId ? nextScript : script));
};

const trimBufferedTerminalReplay = (script: DevServerScriptState): DevServerScriptState => ({
  ...script,
  bufferedTerminalChunks: trimDevServerTerminalChunks(script.bufferedTerminalChunks),
});

export const buildOptimisticStartingState = (state: DevServerGroupState): DevServerGroupState => ({
  ...state,
  updatedAt: new Date().toISOString(),
  scripts: state.scripts.map((script) => ({
    ...script,
    status: "starting",
    pid: null,
    startedAt: null,
    exitCode: null,
    lastError: null,
    bufferedTerminalChunks: [],
  })),
});

export const isDevServerSubscriptionControlEvent = isBrowserLiveControlEvent;

export const applyDevServerEventToState = (
  state: DevServerGroupState | null,
  event: DevServerEvent,
): DevServerGroupState | null => {
  if (event.type === "snapshot") {
    return {
      ...event.state,
      scripts: event.state.scripts.map(trimBufferedTerminalReplay),
    };
  }

  if (!state || state.repoPath !== event.repoPath || state.taskId !== event.taskId) {
    return state;
  }

  if (event.type === "script_status_changed") {
    return {
      ...state,
      updatedAt: event.updatedAt,
      scripts: replaceScript(state.scripts, trimBufferedTerminalReplay(event.script)),
    };
  }

  return {
    ...state,
    updatedAt: event.terminalChunk.timestamp,
    scripts: state.scripts,
  };
};

const toStartedAtMs = (script: DevServerScriptState): number => {
  if (!script.startedAt) {
    return 0;
  }

  const timestamp = Date.parse(script.startedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const selectDefaultDevServerTab = (
  scripts: DevServerScriptState[],
  rememberedScriptId: string | null,
): string | null => {
  if (scripts.length === 0) {
    return null;
  }

  if (rememberedScriptId && scripts.some((script) => script.scriptId === rememberedScriptId)) {
    return rememberedScriptId;
  }

  let mostRecentlyActiveScript: DevServerScriptState | null = null;
  let mostRecentStartedAtMs = 0;

  for (const script of scripts) {
    const startedAtMs = toStartedAtMs(script);
    if (startedAtMs > mostRecentStartedAtMs) {
      mostRecentlyActiveScript = script;
      mostRecentStartedAtMs = startedAtMs;
    }
  }

  if (mostRecentlyActiveScript !== null) {
    return mostRecentlyActiveScript.scriptId;
  }

  return scripts[0]?.scriptId ?? null;
};

export const isDevServerPanelExpanded = (
  scripts: DevServerScriptState[],
  shouldKeepOpen: boolean,
): boolean => {
  if (shouldKeepOpen) {
    return true;
  }

  return scripts.some((script) => script.status !== "stopped");
};
