import type { DevServerScriptState } from "@openducktor/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { selectDefaultDevServerTab } from "./use-agent-studio-dev-server-panel-helpers";

type SelectedScriptMemory = Map<string, string>;

type UseAgentStudioDevServerPanelSelectionArgs = {
  taskMemoryKey: string | null;
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
  taskMemoryKey,
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

  const rememberedScriptId = taskMemoryKey ? (selectionMemory.get(taskMemoryKey) ?? null) : null;

  const effectiveSelectedScriptId = useMemo(() => {
    return selectDefaultDevServerTab(scripts, selectedScriptId ?? rememberedScriptId);
  }, [rememberedScriptId, scripts, selectedScriptId]);

  useLayoutEffect(() => {
    selectedScriptIdRef.current = effectiveSelectedScriptId;
    syncSelectedScriptTerminalBuffer(effectiveSelectedScriptId);

    if (!taskMemoryKey) {
      return;
    }

    if (effectiveSelectedScriptId) {
      selectionMemory.set(taskMemoryKey, effectiveSelectedScriptId);
    } else {
      selectionMemory.delete(taskMemoryKey);
    }

    setSelectedScriptId((current) =>
      current === effectiveSelectedScriptId ? current : effectiveSelectedScriptId,
    );
  }, [effectiveSelectedScriptId, selectionMemory, syncSelectedScriptTerminalBuffer, taskMemoryKey]);

  const onSelectScript = useCallback(
    (scriptId: string): void => {
      if (!taskMemoryKey) {
        return;
      }

      selectionMemory.set(taskMemoryKey, scriptId);
      setSelectedScriptId(scriptId);
    },
    [selectionMemory, taskMemoryKey],
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
