import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentScenario,
  AgentSessionStartMode,
} from "@openducktor/core";
import { getAgentScenarioDefinition } from "@openducktor/core";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_RUNTIME_KIND, resolveRuntimeKindSelection } from "@/lib/agent-runtime";
import type { SessionStartModalIntent } from "./session-start-modal-types";
import { resolveScenarioStartMode } from "./session-start-mode";
import { coerceVisibleSelectionToCatalog, isSameSelection } from "./session-start-selection";
import type { SessionStartExistingSessionOption } from "./session-start-types";

const resolveSourceSelection = (
  options: SessionStartExistingSessionOption[],
  sourceSessionId: string,
): AgentModelSelection | null => {
  if (!sourceSessionId) {
    return null;
  }

  const selectedOption = options.find((option) => option.value === sourceSessionId);
  return selectedOption?.selectedModel ?? null;
};

const resolveInitialStartState = ({
  existingSessionOptions,
  initialSourceSessionId,
  initialStartMode,
  scenario,
}: {
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceSessionId: string | null | undefined;
  initialStartMode: AgentSessionStartMode | undefined;
  scenario: AgentScenario;
}): {
  selectedSourceSessionId: string;
  selectedStartMode: AgentSessionStartMode;
} => {
  const allowedStartModes = getAgentScenarioDefinition(scenario).allowedStartModes;
  const selectedStartMode =
    initialStartMode && allowedStartModes.includes(initialStartMode)
      ? initialStartMode
      : resolveScenarioStartMode({
          scenario,
          existingSessionOptions,
        });

  return {
    selectedStartMode,
    selectedSourceSessionId:
      initialSourceSessionId?.trim() || existingSessionOptions[0]?.value || "",
  };
};

const buildReuseSelectionDraft = ({
  catalog,
  options,
  runtimeDefinitions,
  sourceSessionId,
}: {
  catalog: AgentModelCatalog | null;
  options: SessionStartExistingSessionOption[];
  runtimeDefinitions: RuntimeDescriptor[];
  sourceSessionId: string;
}): {
  runtimeKind: RuntimeKind;
  selection: AgentModelSelection | null;
} => {
  const sourceSelection = resolveSourceSelection(options, sourceSessionId);
  const runtimeKind = resolveRuntimeKindSelection({
    runtimeDefinitions,
    requestedRuntimeKind: sourceSelection?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
  });

  if (!sourceSelection) {
    return {
      runtimeKind,
      selection: null,
    };
  }

  return {
    runtimeKind,
    selection: coerceVisibleSelectionToCatalog(catalog, {
      ...sourceSelection,
      runtimeKind,
    }) ?? {
      ...sourceSelection,
      runtimeKind,
    },
  };
};

type UseSessionStartModalReuseStateArgs = {
  catalog: AgentModelCatalog | null;
  intent: SessionStartModalIntent | null;
  runtimeDefinitions: RuntimeDescriptor[];
  setRequestedRuntimeKind: (runtimeKind: RuntimeKind) => void;
  setSelection: Dispatch<SetStateAction<AgentModelSelection | null>>;
};

type UseSessionStartModalReuseStateResult = {
  availableStartModes: AgentSessionStartMode[];
  existingSessionOptions: SessionStartExistingSessionOption[];
  initializeStartState: (intent: SessionStartModalIntent) => void;
  resetStartState: () => void;
  selectedSourceSessionId: string;
  selectedStartMode: AgentSessionStartMode;
  handleSelectSourceSession: (sessionId: string) => void;
  handleSelectStartMode: (startMode: AgentSessionStartMode) => void;
};

export function useSessionStartModalReuseState({
  catalog,
  intent,
  runtimeDefinitions,
  setRequestedRuntimeKind,
  setSelection,
}: UseSessionStartModalReuseStateArgs): UseSessionStartModalReuseStateResult {
  const [selectedStartMode, setSelectedStartMode] = useState<AgentSessionStartMode>("fresh");
  const [selectedSourceSessionId, setSelectedSourceSessionId] = useState("");

  const availableStartModes = useMemo<AgentSessionStartMode[]>(
    () => (intent ? getAgentScenarioDefinition(intent.scenario).allowedStartModes : ["fresh"]),
    [intent],
  );

  const existingSessionOptions = intent?.existingSessionOptions ?? [];

  const resetStartState = useCallback((): void => {
    setSelectedStartMode("fresh");
    setSelectedSourceSessionId("");
  }, []);

  const initializeStartState = useCallback((nextIntent: SessionStartModalIntent): void => {
    const nextState = resolveInitialStartState({
      scenario: nextIntent.scenario,
      existingSessionOptions: nextIntent.existingSessionOptions ?? [],
      initialStartMode: nextIntent.initialStartMode,
      initialSourceSessionId: nextIntent.initialSourceSessionId,
    });
    setSelectedStartMode(nextState.selectedStartMode);
    setSelectedSourceSessionId(nextState.selectedSourceSessionId);
  }, []);

  const applyReuseSourceSelection = useCallback(
    (sourceSessionId: string): void => {
      const nextDraft = buildReuseSelectionDraft({
        catalog,
        options: existingSessionOptions,
        runtimeDefinitions,
        sourceSessionId,
      });
      setRequestedRuntimeKind(nextDraft.runtimeKind);
      setSelection((current) =>
        isSameSelection(current, nextDraft.selection) ? current : nextDraft.selection,
      );
    },
    [catalog, existingSessionOptions, runtimeDefinitions, setRequestedRuntimeKind, setSelection],
  );

  const handleSelectStartMode = useCallback(
    (startMode: AgentSessionStartMode): void => {
      if ((startMode === "reuse" || startMode === "fork") && existingSessionOptions.length === 0) {
        return;
      }

      setSelectedStartMode(startMode);
      if (startMode !== "reuse") {
        return;
      }

      const nextSourceSessionId = selectedSourceSessionId || existingSessionOptions[0]?.value || "";
      if (!nextSourceSessionId) {
        return;
      }

      setSelectedSourceSessionId(nextSourceSessionId);
      applyReuseSourceSelection(nextSourceSessionId);
    },
    [applyReuseSourceSelection, existingSessionOptions, selectedSourceSessionId],
  );

  const handleSelectSourceSession = useCallback(
    (sessionId: string): void => {
      setSelectedSourceSessionId(sessionId);
      if (selectedStartMode !== "reuse") {
        return;
      }
      applyReuseSourceSelection(sessionId);
    },
    [applyReuseSourceSelection, selectedStartMode],
  );

  useEffect(() => {
    if (selectedStartMode !== "reuse") {
      return;
    }
    if (!selectedSourceSessionId) {
      return;
    }
    applyReuseSourceSelection(selectedSourceSessionId);
  }, [applyReuseSourceSelection, selectedSourceSessionId, selectedStartMode]);

  useEffect(() => {
    if (selectedStartMode !== "reuse" && selectedStartMode !== "fork") {
      return;
    }
    if (existingSessionOptions.length > 0) {
      return;
    }
    if (!availableStartModes.includes("fresh")) {
      return;
    }
    setSelectedStartMode("fresh");
  }, [availableStartModes, existingSessionOptions, selectedStartMode]);

  return {
    availableStartModes,
    existingSessionOptions,
    initializeStartState,
    resetStartState,
    selectedSourceSessionId,
    selectedStartMode,
    handleSelectSourceSession,
    handleSelectStartMode,
  };
}
