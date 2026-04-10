import type { DevServerScriptState } from "@openducktor/contracts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const selectionMemoryRef = useRef<SelectedScriptMemory>(new Map());
  const selectedScriptIdRef = useRef<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  const rememberedScriptId = taskMemoryKey
    ? (selectionMemoryRef.current.get(taskMemoryKey) ?? null)
    : null;

  const effectiveSelectedScriptId = useMemo(() => {
    return selectDefaultDevServerTab(scripts, selectedScriptId ?? rememberedScriptId);
  }, [rememberedScriptId, scripts, selectedScriptId]);

  useLayoutEffect(() => {
    selectedScriptIdRef.current = effectiveSelectedScriptId;
    syncSelectedScriptTerminalBuffer(effectiveSelectedScriptId);
  }, [effectiveSelectedScriptId, syncSelectedScriptTerminalBuffer]);

  useEffect(() => {
    if (!taskMemoryKey) {
      return;
    }

    if (effectiveSelectedScriptId) {
      selectionMemoryRef.current.set(taskMemoryKey, effectiveSelectedScriptId);
      if (selectedScriptId !== effectiveSelectedScriptId) {
        setSelectedScriptId(effectiveSelectedScriptId);
      }
      return;
    }

    selectionMemoryRef.current.delete(taskMemoryKey);
    if (selectedScriptId !== null) {
      setSelectedScriptId(null);
    }
  }, [effectiveSelectedScriptId, selectedScriptId, taskMemoryKey]);

  const onSelectScript = useCallback(
    (scriptId: string): void => {
      if (!taskMemoryKey) {
        return;
      }

      selectionMemoryRef.current.set(taskMemoryKey, scriptId);
      setSelectedScriptId(scriptId);
    },
    [taskMemoryKey],
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
