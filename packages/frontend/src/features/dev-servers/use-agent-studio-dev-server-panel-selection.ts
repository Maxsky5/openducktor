import type { DevServerScriptState } from "@openducktor/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { selectDefaultDevServerTab } from "./use-agent-studio-dev-server-panel-helpers";

type SelectedScriptMemory = Map<string, string>;

type UseAgentStudioDevServerPanelSelectionArgs = {
  scopeKey: string | null;
  scripts: DevServerScriptState[];
};

type UseAgentStudioDevServerPanelSelectionResult = {
  effectiveSelectedScriptId: string | null;
  onSelectScript: (scriptId: string) => void;
};

export const useAgentStudioDevServerPanelSelection = ({
  scopeKey,
  scripts,
}: UseAgentStudioDevServerPanelSelectionArgs): UseAgentStudioDevServerPanelSelectionResult => {
  const selectionMemoryRef = useRef<SelectedScriptMemory | null>(null);
  if (selectionMemoryRef.current === null) {
    selectionMemoryRef.current = new Map();
  }
  const selectionMemory = selectionMemoryRef.current;
  const [selection, setSelection] = useState<{ scopeKey: string; scriptId: string } | null>(null);
  const selectedScriptId = selection?.scopeKey === scopeKey ? selection?.scriptId : null;

  const rememberedScriptId = scopeKey ? (selectionMemory.get(scopeKey) ?? null) : null;

  const effectiveSelectedScriptId = useMemo(() => {
    return selectDefaultDevServerTab(scripts, selectedScriptId ?? rememberedScriptId);
  }, [rememberedScriptId, scripts, selectedScriptId]);

  useLayoutEffect(() => {
    if (!scopeKey) {
      return;
    }

    if (effectiveSelectedScriptId) {
      selectionMemory.set(scopeKey, effectiveSelectedScriptId);
    } else {
      selectionMemory.delete(scopeKey);
    }
  }, [effectiveSelectedScriptId, selectionMemory, scopeKey]);

  const onSelectScript = useCallback(
    (scriptId: string): void => {
      if (!scopeKey) {
        return;
      }

      selectionMemory.set(scopeKey, scriptId);
      setSelection({ scopeKey, scriptId });
    },
    [selectionMemory, scopeKey],
  );

  return {
    effectiveSelectedScriptId,
    onSelectScript,
  };
};
