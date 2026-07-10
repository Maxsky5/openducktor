import type { DevServerEvent, DevServerGroupState } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
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
import {
  canApplyDevServerGroupState,
  canApplyDevServerScriptStateToStore,
} from "@/features/agent-studio-build-tools/dev-server-run-ownership";
import {
  type DevServerTaskScope,
  formatDevServerTaskScopeKey,
} from "@/types/dev-server-task-scope";

type PendingMutationReplaySync = {
  baselineByScriptId: Map<string, number | null>;
  observedScriptIds: Set<string>;
  scopeKey: string;
};

type SelectedScriptTerminalBufferState = {
  buffer: AgentStudioDevServerTerminalBuffer | null;
  scopeKey: string;
};

type DevServerTerminalBufferOwner = {
  pendingMutationReplaySync: PendingMutationReplaySync | null;
  scopeKey: string;
  terminalBuffers: DevServerTerminalBufferStore;
};

type UseAgentStudioDevServerTerminalBuffersResult = {
  applyTerminalBuffersFromEvent: (
    event: DevServerEvent,
    selectedScriptId: string | null,
  ) => boolean;
  beginMutationReplaySync: (state: DevServerGroupState | null) => void;
  cancelMutationReplaySync: () => void;
  clearTerminalBuffers: () => void;
  hydrateTerminalBuffersFromState: (
    state: DevServerGroupState | null,
    selectedScriptId: string | null,
  ) => boolean;
  markMutationReplayObserved: (event: DevServerEvent) => void;
  replaceTerminalBuffersFromState: (
    state: DevServerGroupState | null,
    selectedScriptId: string | null,
  ) => boolean;
  selectedScriptTerminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  syncSelectedScriptTerminalBuffer: (scriptId: string | null) => void;
  syncTerminalBuffersFromMutationState: (
    state: DevServerGroupState,
    selectedScriptId: string | null,
  ) => boolean;
};

const isDevServerStateInScope = (
  state: DevServerGroupState,
  scope: DevServerTaskScope | null,
): boolean => {
  if (!scope) {
    return false;
  }

  return state.repoPath === scope.repoPath && state.taskId === scope.taskId;
};

const isDevServerEventInScope = (
  event: DevServerEvent,
  scope: DevServerTaskScope | null,
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
  scope: DevServerTaskScope | null,
): UseAgentStudioDevServerTerminalBuffersResult => {
  const requestedScopeKey = formatDevServerTaskScopeKey(scope);
  const terminalBufferOwner = useMemo<DevServerTerminalBufferOwner>(
    () => ({
      pendingMutationReplaySync: null,
      scopeKey: requestedScopeKey,
      terminalBuffers: createDevServerTerminalBufferStore(),
    }),
    [requestedScopeKey],
  );
  const [selectedScriptTerminalBufferState, setSelectedScriptTerminalBufferState] =
    useState<SelectedScriptTerminalBufferState | null>(null);
  const activeScopeKey = terminalBufferOwner.scopeKey;
  const terminalBuffers = terminalBufferOwner.terminalBuffers;

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
    (state: DevServerGroupState | null, selectedScriptId: string | null): boolean => {
      if (state !== null && !isDevServerStateInScope(state, scope)) {
        return false;
      }
      if (state !== null && !canApplyDevServerGroupState(terminalBuffers, state)) {
        return false;
      }

      syncDevServerTerminalBufferStore(terminalBuffers, state);
      syncSelectedScriptTerminalBuffer(selectedScriptId);
      return true;
    },
    [scope, syncSelectedScriptTerminalBuffer, terminalBuffers],
  );

  const hydrateTerminalBuffersFromState = useCallback(
    (state: DevServerGroupState | null, selectedScriptId: string | null): boolean => {
      if (state === null) {
        return false;
      }

      if (!isDevServerStateInScope(state, scope)) {
        return false;
      }
      if (!canApplyDevServerGroupState(terminalBuffers, state)) {
        return false;
      }

      if (terminalBuffers.size === 0) {
        return replaceTerminalBuffersFromState(state, selectedScriptId);
      }

      if (reconcileDevServerTerminalBufferStore(terminalBuffers, state)) {
        syncSelectedScriptTerminalBuffer(selectedScriptId);
      }
      return true;
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

      terminalBufferOwner.pendingMutationReplaySync = {
        baselineByScriptId,
        observedScriptIds: new Set(),
        scopeKey: activeScopeKey,
      };
    },
    [activeScopeKey, scope, terminalBufferOwner, terminalBuffers],
  );

  const syncTerminalBuffersFromMutationState = useCallback(
    (state: DevServerGroupState, selectedScriptId: string | null): boolean => {
      if (!isDevServerStateInScope(state, scope)) {
        return false;
      }
      if (!canApplyDevServerGroupState(terminalBuffers, state)) {
        return false;
      }

      const pendingReplaySync = terminalBufferOwner.pendingMutationReplaySync;
      if (!pendingReplaySync) {
        return hydrateTerminalBuffersFromState(state, selectedScriptId);
      }

      if (pendingReplaySync.scopeKey !== activeScopeKey) {
        terminalBufferOwner.pendingMutationReplaySync = null;
        return hydrateTerminalBuffersFromState(state, selectedScriptId);
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

      terminalBufferOwner.pendingMutationReplaySync = null;
      syncSelectedScriptTerminalBuffer(selectedScriptId);
      return true;
    },
    [
      activeScopeKey,
      hydrateTerminalBuffersFromState,
      scope,
      syncSelectedScriptTerminalBuffer,
      terminalBufferOwner,
      terminalBuffers,
    ],
  );

  const markMutationReplayObserved = useCallback(
    (event: DevServerEvent): void => {
      if (!isDevServerEventInScope(event, scope)) {
        return;
      }

      const pendingReplaySync = terminalBufferOwner.pendingMutationReplaySync;
      if (!pendingReplaySync) {
        return;
      }

      if (pendingReplaySync.scopeKey !== activeScopeKey) {
        terminalBufferOwner.pendingMutationReplaySync = null;
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
    [activeScopeKey, scope, terminalBufferOwner],
  );

  const applyTerminalBuffersFromEvent = useCallback(
    (event: DevServerEvent, selectedScriptId: string | null): boolean => {
      if (!isDevServerEventInScope(event, scope)) {
        return false;
      }

      if (event.type === "snapshot") {
        return hydrateTerminalBuffersFromState(event.state, selectedScriptId);
      }

      if (event.type === "script_status_changed") {
        const replacementContext = getDevServerTerminalBufferReplacementContext(
          terminalBuffers,
          event.script.scriptId,
        );
        if (!canApplyDevServerScriptStateToStore(terminalBuffers, event.script)) {
          return false;
        }
        const replacement = getDevServerTerminalBufferReplacement(replacementContext, event.script);
        if (replacement !== null) {
          applyDevServerTerminalBufferReplacement(
            terminalBuffers,
            event.script.scriptId,
            replacement,
          );
        }
      } else if (!appendDevServerTerminalChunk(terminalBuffers, event.terminalChunk)) {
        return false;
      }

      const touchedScriptId =
        event.type === "script_status_changed"
          ? event.script.scriptId
          : event.terminalChunk.scriptId;
      if (selectedScriptId && touchedScriptId === selectedScriptId) {
        syncSelectedScriptTerminalBuffer(selectedScriptId);
      }
      return true;
    },
    [hydrateTerminalBuffersFromState, scope, syncSelectedScriptTerminalBuffer, terminalBuffers],
  );

  const cancelMutationReplaySync = useCallback((): void => {
    terminalBufferOwner.pendingMutationReplaySync = null;
  }, [terminalBufferOwner]);

  const clearTerminalBuffers = useCallback((): void => {
    terminalBuffers.clear();
    terminalBufferOwner.pendingMutationReplaySync = null;
    setSelectedScriptTerminalBufferState({ buffer: null, scopeKey: activeScopeKey });
  }, [activeScopeKey, terminalBufferOwner, terminalBuffers]);
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
