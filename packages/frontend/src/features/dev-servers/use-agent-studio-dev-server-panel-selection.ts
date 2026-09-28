import type { DevServerScriptState } from "@openducktor/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { selectDefaultDevServerTab } from "./use-agent-studio-dev-server-panel-helpers";

type SelectedScriptMemory = Map<string, string>;

type UseAgentStudioDevServerPanelSelectionArgs = {
  scopeKey: string | null;
  scripts: DevServerScriptState[];
  syncSelectedScriptTerminalBuffer: (scriptId: string | null) => void;
};

type UseAgentStudioDevServerPanelSelectionResult = {
  effectiveSelectedScriptId: string | null;
  onSelectScript: (scriptId: string) => void;
  resetSelectedScript: () => void;
  selectedScriptIdRef: { current: string | null };
};

export const useAgentStudioDevServerPanelSelection = ({
  scopeKey,
  scripts,
  syncSelectedScriptTerminalBuffer,
}: UseAgentStudioDevServerPanelSelectionArgs): UseAgentStudioDevServerPanelSelectionResult => {
  const selectionMemoryRef = useRef<SelectedScriptMemory | null>(null);
  if (selectionMemoryRef.current === null) {
    selectionMemoryRef.current = new Map();
  }
  const selectionMemory = selectionMemoryRef.current;
  const selectedScriptIdRef = useRef<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  const rememberedScriptId = scopeKey ? (selectionMemory.get(scopeKey) ?? null) : null;

  const effectiveSelectedScriptId = useMemo(() => {
    return selectDefaultDevServerTab(scripts, selectedScriptId ?? rememberedScriptId);
  }, [rememberedScriptId, scripts, selectedScriptId]);

  useLayoutEffect(() => {
    selectedScriptIdRef.current = effectiveSelectedScriptId;
    syncSelectedScriptTerminalBuffer(effectiveSelectedScriptId);

    if (!scopeKey) {
      return;
    }

    if (effectiveSelectedScriptId) {
      selectionMemory.set(scopeKey, effectiveSelectedScriptId);
    } else {
      selectionMemory.delete(scopeKey);
    }

    setSelectedScriptId((current) =>
      current === effectiveSelectedScriptId ? current : effectiveSelectedScriptId,
    );
  }, [effectiveSelectedScriptId, selectionMemory, syncSelectedScriptTerminalBuffer, scopeKey]);

  const onSelectScript = useCallback(
    (scriptId: string): void => {
      if (!scopeKey) {
        return;
      }

      selectionMemory.set(scopeKey, scriptId);
      setSelectedScriptId(scriptId);
    },
    [selectionMemory, scopeKey],
  );

  const resetSelectedScript = useCallback((): void => {
    selectedScriptIdRef.current = null;
    setSelectedScriptId(null);
    syncSelectedScriptTerminalBuffer(null);
  }, [syncSelectedScriptTerminalBuffer]);

  return {
    effectiveSelectedScriptId,
    onSelectScript,
    resetSelectedScript,
    selectedScriptIdRef,
  };
};
