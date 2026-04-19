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
  replaceDevServerTerminalBuffer,
  shouldReplaceDevServerTerminalBufferFromScript,
  syncDevServerTerminalBufferStore,
} from "@/features/agent-studio-build-tools/dev-server-log-buffer";

type PendingMutationReplaySync = {
  baselineByScriptId: Map<string, number | null>;
  observedScriptIds: Set<string>;
};

type UseAgentStudioDevServerTerminalBuffersResult = {
  applyTerminalBuffersFromEvent: (event: DevServerEvent, selectedScriptId: string | null) => void;
  beginMutationReplaySync: (state: DevServerGroupState | null) => void;
  cancelMutationReplaySync: () => void;
  clearTerminalBuffers: () => void;
  hydrateTerminalBuffersFromState: (
    state: DevServerGroupState | null,
    selectedScriptId: string | null,
    force?: boolean,
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

export const useAgentStudioDevServerTerminalBuffers =
  (): UseAgentStudioDevServerTerminalBuffersResult => {
    const terminalBuffersRef = useRef<DevServerTerminalBufferStore>(
      createDevServerTerminalBufferStore(),
    );
    const pendingMutationReplaySyncRef = useRef<PendingMutationReplaySync | null>(null);
    const [selectedScriptTerminalBuffer, setSelectedScriptTerminalBuffer] =
      useState<AgentStudioDevServerTerminalBuffer | null>(null);

    const syncSelectedScriptTerminalBuffer = useCallback((scriptId: string | null): void => {
      setSelectedScriptTerminalBuffer(
        getDevServerTerminalBuffer(terminalBuffersRef.current, scriptId),
      );
    }, []);

    const replaceTerminalBuffersFromState = useCallback(
      (state: DevServerGroupState | null, selectedScriptId: string | null): void => {
        syncDevServerTerminalBufferStore(terminalBuffersRef.current, state);
        syncSelectedScriptTerminalBuffer(selectedScriptId);
      },
      [syncSelectedScriptTerminalBuffer],
    );

    const hydrateTerminalBuffersFromState = useCallback(
      (state: DevServerGroupState | null, selectedScriptId: string | null, force = false): void => {
        if (state === null) {
          if (force) {
            replaceTerminalBuffersFromState(null, selectedScriptId);
          }
          return;
        }

        if (force || terminalBuffersRef.current.size === 0) {
          replaceTerminalBuffersFromState(state, selectedScriptId);
          return;
        }

        if (reconcileDevServerTerminalBufferStore(terminalBuffersRef.current, state)) {
          syncSelectedScriptTerminalBuffer(selectedScriptId);
        }
      },
      [replaceTerminalBuffersFromState, syncSelectedScriptTerminalBuffer],
    );

    const beginMutationReplaySync = useCallback((state: DevServerGroupState | null): void => {
      const baselineByScriptId = new Map<string, number | null>();

      for (const script of state?.scripts ?? []) {
        baselineByScriptId.set(
          script.scriptId,
          getDevServerTerminalBuffer(terminalBuffersRef.current, script.scriptId)?.lastSequence ??
            null,
        );
      }

      pendingMutationReplaySyncRef.current = {
        baselineByScriptId,
        observedScriptIds: new Set(),
      };
    }, []);

    const syncTerminalBuffersFromMutationState = useCallback(
      (state: DevServerGroupState, selectedScriptId: string | null): void => {
        const pendingReplaySync = pendingMutationReplaySyncRef.current;
        if (!pendingReplaySync) {
          hydrateTerminalBuffersFromState(state, selectedScriptId);
          return;
        }

        const nextScriptIds = new Set(state.scripts.map((script) => script.scriptId));
        for (const scriptId of terminalBuffersRef.current.keys()) {
          if (!nextScriptIds.has(scriptId)) {
            terminalBuffersRef.current.delete(scriptId);
          }
        }

        for (const script of state.scripts) {
          const currentBuffer = getDevServerTerminalBuffer(
            terminalBuffersRef.current,
            script.scriptId,
          );
          const currentLastSequence = currentBuffer?.lastSequence ?? null;
          const baselineLastSequence =
            pendingReplaySync.baselineByScriptId.get(script.scriptId) ?? null;
          const currentContext = getDevServerTerminalBufferReplacementContext(
            terminalBuffersRef.current,
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
            applyDevServerTerminalBufferReplacement(
              terminalBuffersRef.current,
              script.scriptId,
              replacement,
            );
          }
        }

        pendingMutationReplaySyncRef.current = null;
        syncSelectedScriptTerminalBuffer(selectedScriptId);
      },
      [hydrateTerminalBuffersFromState, syncSelectedScriptTerminalBuffer],
    );

    const markMutationReplayObserved = useCallback((event: DevServerEvent): void => {
      const pendingReplaySync = pendingMutationReplaySyncRef.current;
      if (!pendingReplaySync) {
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
    }, []);

    const applyTerminalBuffersFromEvent = useCallback(
      (event: DevServerEvent, selectedScriptId: string | null): void => {
        if (event.type === "snapshot") {
          syncDevServerTerminalBufferStore(terminalBuffersRef.current, event.state);
          syncSelectedScriptTerminalBuffer(selectedScriptId);
          return;
        }

        if (event.type === "script_status_changed") {
          replaceDevServerTerminalBuffer(
            terminalBuffersRef.current,
            event.script.scriptId,
            event.script.bufferedTerminalChunks,
          );
        } else {
          appendDevServerTerminalChunk(terminalBuffersRef.current, event.terminalChunk);
        }

        const touchedScriptId =
          event.type === "script_status_changed"
            ? event.script.scriptId
            : event.terminalChunk.scriptId;
        if (selectedScriptId && touchedScriptId === selectedScriptId) {
          syncSelectedScriptTerminalBuffer(selectedScriptId);
        }
      },
      [syncSelectedScriptTerminalBuffer],
    );

    const cancelMutationReplaySync = useCallback((): void => {
      pendingMutationReplaySyncRef.current = null;
    }, []);

    const clearTerminalBuffers = useCallback((): void => {
      terminalBuffersRef.current.clear();
      pendingMutationReplaySyncRef.current = null;
      setSelectedScriptTerminalBuffer(null);
    }, []);

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
