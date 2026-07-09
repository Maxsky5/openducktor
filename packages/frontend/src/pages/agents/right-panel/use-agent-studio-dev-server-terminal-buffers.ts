import type { DevServerEvent, DevServerGroupState } from "@openducktor/contracts";
import { useCallback, useRef, useState } from "react";
import {
  type AgentStudioDevServerTerminalBuffer,
  appendDevServerTerminalChunk,
  applyDevServerTerminalBufferReplacement,
  createDevServerTerminalBufferStore,
  type DevServerTerminalBufferStore,
  getDevServerTerminalBuffer,
  getDevServerTerminalBufferReplacement,
  getDevServerTerminalBufferReplacementContext,
  reconcileDevServerTerminalBufferStore,
  shouldReplaceDevServerTerminalBufferFromScript,
  syncDevServerTerminalBufferStore,
} from "@/features/agent-studio-build-tools/dev-server-log-buffer";

type PendingMutationReplaySync = {
  baselineByScriptId: Map<string, number | null>;
  observedScriptIds: Set<string>;
  scopeKey: string;
};

type SelectedScriptTerminalBufferState = {
  buffer: AgentStudioDevServerTerminalBuffer | null;
  scopeKey: string;
};

type DevServerTerminalBufferScope = {
  repoPath: string;
  taskId: string;
};

type UseAgentStudioDevServerTerminalBuffersResult = {
  applyTerminalBuffersFromEvent: (event: DevServerEvent, selectedScriptId: string | null) => void;
  beginMutationReplaySync: (state: DevServerGroupState | null) => void;
  cancelMutationReplaySync: () => void;
  clearTerminalBuffers: () => void;
  hydrateTerminalBuffersFromState: (
    state: DevServerGroupState | null,
    selectedScriptId: string | null,
  ) => void;
  markMutationReplayObserved: (event: DevServerEvent) => void;
  replaceTerminalBuffersFromState: (
    state: DevServerGroupState | null,
    selectedScriptId: string | null,
  ) => void;
  selectedScriptTerminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  syncSelectedScriptTerminalBuffer: (scriptId: string | null) => void;
  syncTerminalBuffersFromMutationState: (
    state: DevServerGroupState,
    selectedScriptId: string | null,
  ) => void;
};

const isDevServerStateInScope = (
  state: DevServerGroupState,
  scope: DevServerTerminalBufferScope | null,
): boolean => {
  if (!scope) {
    return false;
  }

  return state.repoPath === scope.repoPath && state.taskId === scope.taskId;
};

const isDevServerEventInScope = (
  event: DevServerEvent,
  scope: DevServerTerminalBufferScope | null,
): boolean => {
  if (!scope) {
    return false;
  }

  if (event.type === "snapshot") {
    return isDevServerStateInScope(event.state, scope);
  }

  return event.repoPath === scope.repoPath && event.taskId === scope.taskId;
};

export const useAgentStudioDevServerTerminalBuffers = (
  scope: DevServerTerminalBufferScope | null,
): UseAgentStudioDevServerTerminalBuffersResult => {
  const scopeKey = scope ? `${scope.repoPath}::${scope.taskId}` : null;
  const activeScopeKey = scopeKey ?? "__no-dev-server-task__";
  const terminalBuffersRef = useRef<DevServerTerminalBufferStore | null>(null);
  const terminalBuffersScopeRef = useRef<string | null>(null);
  const pendingMutationReplaySyncRef = useRef<PendingMutationReplaySync | null>(null);
  const [selectedScriptTerminalBufferState, setSelectedScriptTerminalBufferState] =
    useState<SelectedScriptTerminalBufferState | null>(null);

  if (terminalBuffersRef.current === null || terminalBuffersScopeRef.current !== activeScopeKey) {
    terminalBuffersRef.current = createDevServerTerminalBufferStore();
    terminalBuffersScopeRef.current = activeScopeKey;
    pendingMutationReplaySyncRef.current = null;
  }
  const terminalBuffers = terminalBuffersRef.current;

  const syncSelectedScriptTerminalBuffer = useCallback(
    (scriptId: string | null): void => {
      setSelectedScriptTerminalBufferState({
        buffer: getDevServerTerminalBuffer(terminalBuffers, scriptId),
        scopeKey: activeScopeKey,
      });
    },
    [activeScopeKey, terminalBuffers],
  );

  const replaceTerminalBuffersFromState = useCallback(
    (state: DevServerGroupState | null, selectedScriptId: string | null): void => {
      if (state !== null && !isDevServerStateInScope(state, scope)) {
        return;
      }

      syncDevServerTerminalBufferStore(terminalBuffers, state);
      syncSelectedScriptTerminalBuffer(selectedScriptId);
    },
    [scope, syncSelectedScriptTerminalBuffer, terminalBuffers],
  );

  const hydrateTerminalBuffersFromState = useCallback(
    (state: DevServerGroupState | null, selectedScriptId: string | null): void => {
      if (state === null) {
        return;
      }

      if (!isDevServerStateInScope(state, scope)) {
        return;
      }

      if (terminalBuffers.size === 0) {
        replaceTerminalBuffersFromState(state, selectedScriptId);
        return;
      }

      if (reconcileDevServerTerminalBufferStore(terminalBuffers, state)) {
        syncSelectedScriptTerminalBuffer(selectedScriptId);
      }
    },
    [replaceTerminalBuffersFromState, scope, syncSelectedScriptTerminalBuffer, terminalBuffers],
  );

  const beginMutationReplaySync = useCallback(
    (state: DevServerGroupState | null): void => {
      if (state !== null && !isDevServerStateInScope(state, scope)) {
        return;
      }

      const baselineByScriptId = new Map<string, number | null>();

      for (const script of state?.scripts ?? []) {
        baselineByScriptId.set(
          script.scriptId,
          getDevServerTerminalBuffer(terminalBuffers, script.scriptId)?.lastSequence ?? null,
        );
      }

      pendingMutationReplaySyncRef.current = {
        baselineByScriptId,
        observedScriptIds: new Set(),
        scopeKey: activeScopeKey,
      };
    },
    [activeScopeKey, scope, terminalBuffers],
  );

  const syncTerminalBuffersFromMutationState = useCallback(
    (state: DevServerGroupState, selectedScriptId: string | null): void => {
      if (!isDevServerStateInScope(state, scope)) {
        return;
      }

      const pendingReplaySync = pendingMutationReplaySyncRef.current;
      if (!pendingReplaySync) {
        hydrateTerminalBuffersFromState(state, selectedScriptId);
        return;
      }

      if (pendingReplaySync.scopeKey !== activeScopeKey) {
        pendingMutationReplaySyncRef.current = null;
        hydrateTerminalBuffersFromState(state, selectedScriptId);
        return;
      }

      const nextScriptIds = new Set(state.scripts.map((script) => script.scriptId));
      for (const scriptId of terminalBuffers.keys()) {
        if (!nextScriptIds.has(scriptId)) {
          terminalBuffers.delete(scriptId);
        }
      }

      for (const script of state.scripts) {
        const currentBuffer = getDevServerTerminalBuffer(terminalBuffers, script.scriptId);
        const currentLastSequence = currentBuffer?.lastSequence ?? null;
        const baselineLastSequence =
          pendingReplaySync.baselineByScriptId.get(script.scriptId) ?? null;
        const currentContext = getDevServerTerminalBufferReplacementContext(
          terminalBuffers,
          script.scriptId,
        );
        // Replace if no live replay was observed, if we only re-observed the baseline,
        // or if the authoritative replay window proves the local buffer is stale.
        const shouldReplaceReplay =
          !pendingReplaySync.observedScriptIds.has(script.scriptId) ||
          currentLastSequence === baselineLastSequence ||
          shouldReplaceDevServerTerminalBufferFromScript(currentContext, script);

        if (shouldReplaceReplay) {
          const replacement =
            !pendingReplaySync.observedScriptIds.has(script.scriptId) ||
            currentLastSequence === baselineLastSequence
              ? getDevServerTerminalBufferReplacement(null, script)
              : getDevServerTerminalBufferReplacement(currentContext, script);
          if (replacement === null) {
            continue;
          }

          // Mutation success replaces the replay baseline when no new live output arrived yet.
          applyDevServerTerminalBufferReplacement(terminalBuffers, script.scriptId, replacement);
        }
      }

      pendingMutationReplaySyncRef.current = null;
      syncSelectedScriptTerminalBuffer(selectedScriptId);
    },
    [
      activeScopeKey,
      hydrateTerminalBuffersFromState,
      scope,
      syncSelectedScriptTerminalBuffer,
      terminalBuffers,
    ],
  );

  const markMutationReplayObserved = useCallback(
    (event: DevServerEvent): void => {
      if (!isDevServerEventInScope(event, scope)) {
        return;
      }

      const pendingReplaySync = pendingMutationReplaySyncRef.current;
      if (!pendingReplaySync) {
        return;
      }

      if (pendingReplaySync.scopeKey !== activeScopeKey) {
        pendingMutationReplaySyncRef.current = null;
        return;
      }

      if (event.type === "snapshot") {
        for (const script of event.state.scripts) {
          pendingReplaySync.observedScriptIds.add(script.scriptId);
        }
        return;
      }

      if (event.type === "script_status_changed") {
        pendingReplaySync.observedScriptIds.add(event.script.scriptId);
        return;
      }

      pendingReplaySync.observedScriptIds.add(event.terminalChunk.scriptId);
    },
    [activeScopeKey, scope],
  );

  const applyTerminalBuffersFromEvent = useCallback(
    (event: DevServerEvent, selectedScriptId: string | null): void => {
      if (!isDevServerEventInScope(event, scope)) {
        return;
      }

      if (event.type === "snapshot") {
        hydrateTerminalBuffersFromState(event.state, selectedScriptId);
        return;
      }

      if (event.type === "script_status_changed") {
        const replacementContext =
          event.script.status === "starting"
            ? null
            : getDevServerTerminalBufferReplacementContext(terminalBuffers, event.script.scriptId);
        const replacement = getDevServerTerminalBufferReplacement(replacementContext, event.script);
        if (replacement === null) {
          return;
        }

        applyDevServerTerminalBufferReplacement(
          terminalBuffers,
          event.script.scriptId,
          replacement,
        );
      } else {
        appendDevServerTerminalChunk(terminalBuffers, event.terminalChunk);
      }

      const touchedScriptId =
        event.type === "script_status_changed"
          ? event.script.scriptId
          : event.terminalChunk.scriptId;
      if (selectedScriptId && touchedScriptId === selectedScriptId) {
        syncSelectedScriptTerminalBuffer(selectedScriptId);
      }
    },
    [hydrateTerminalBuffersFromState, scope, syncSelectedScriptTerminalBuffer, terminalBuffers],
  );

  const cancelMutationReplaySync = useCallback((): void => {
    pendingMutationReplaySyncRef.current = null;
  }, []);

  const clearTerminalBuffers = useCallback((): void => {
    terminalBuffers.clear();
    pendingMutationReplaySyncRef.current = null;
    setSelectedScriptTerminalBufferState({ buffer: null, scopeKey: activeScopeKey });
  }, [activeScopeKey, terminalBuffers]);
  const selectedScriptTerminalBuffer =
    selectedScriptTerminalBufferState?.scopeKey === activeScopeKey
      ? selectedScriptTerminalBufferState.buffer
      : null;

  return {
    applyTerminalBuffersFromEvent,
    beginMutationReplaySync,
    cancelMutationReplaySync,
    clearTerminalBuffers,
    hydrateTerminalBuffersFromState,
    markMutationReplayObserved,
    replaceTerminalBuffersFromState,
    selectedScriptTerminalBuffer,
    syncSelectedScriptTerminalBuffer,
    syncTerminalBuffersFromMutationState,
  };
};
