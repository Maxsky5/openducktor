import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionStartMode,
} from "@openducktor/core";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { resolveRuntimeKindSelection } from "@/lib/agent-runtime";
import { getSessionLaunchAction, type SessionLaunchActionId } from "./session-start-launch-options";
import type { SessionStartModalIntent } from "./session-start-modal-types";
import { resolveLaunchStartMode } from "./session-start-mode";
import { coerceVisibleSelectionToCatalog, isSameSelection } from "./session-start-selection";
import type { SessionStartExistingSessionOption } from "./session-start-types";

const resolveSourceSelection = (
  options: SessionStartExistingSessionOption[],
  sourceExternalSessionId: string,
): AgentModelSelection | null => {
  if (!sourceExternalSessionId) {
    return null;
  }

  const selectedOption = options.find((option) => option.value === sourceExternalSessionId);
  return selectedOption?.selectedModel ?? null;
};

const resolveValidSourceSessionId = (
  options: SessionStartExistingSessionOption[],
  sourceExternalSessionId: string | null | undefined,
): string => {
  const normalizedSourceSessionId = sourceExternalSessionId?.trim() ?? "";
  if (!normalizedSourceSessionId) {
    return options[0]?.value ?? "";
  }

  return options.some((option) => option.value === normalizedSourceSessionId)
    ? normalizedSourceSessionId
    : (options[0]?.value ?? "");
};

const resolveInitialStartState = ({
  existingSessionOptions,
  initialSourceExternalSessionId,
  initialStartMode,
  launchActionId,
}: {
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceExternalSessionId: string | null | undefined;
  initialStartMode: AgentSessionStartMode | undefined;
  launchActionId: SessionLaunchActionId;
}): {
  selectedSourceSessionId: string;
  selectedStartMode: AgentSessionStartMode;
} => {
  const allowedStartModes = getSessionLaunchAction(launchActionId).allowedStartModes;
  const selectedStartMode =
    initialStartMode && allowedStartModes.includes(initialStartMode)
      ? initialStartMode
      : resolveLaunchStartMode({
          launchActionId,
          existingSessionOptions,
        });

  return {
    selectedStartMode,
    selectedSourceSessionId: resolveValidSourceSessionId(
      existingSessionOptions,
      initialSourceExternalSessionId,
    ),
  };
};

const buildReuseSelectionDraft = ({
  catalog,
  options,
  runtimeDefinitions,
  sourceExternalSessionId,
}: {
  catalog: AgentModelCatalog | null;
  options: SessionStartExistingSessionOption[];
  runtimeDefinitions: RuntimeDescriptor[];
  sourceExternalSessionId: string;
}): {
  runtimeKind: RuntimeKind | null;
  selection: AgentModelSelection | null;
} => {
  const sourceSelection = resolveSourceSelection(options, sourceExternalSessionId);
  const runtimeKind = resolveRuntimeKindSelection({
    runtimeDefinitions,
    requestedRuntimeKind: sourceSelection?.runtimeKind ?? null,
  });

  if (!sourceSelection || !runtimeKind) {
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
  setRequestedRuntimeKind: (runtimeKind: RuntimeKind | null) => void;
  setSelection: Dispatch<SetStateAction<AgentModelSelection | null>>;
};

type UseSessionStartModalReuseStateResult = {
  availableStartModes: AgentSessionStartMode[];
  existingSessionOptions: SessionStartExistingSessionOption[];
  initializeStartState: (intent: SessionStartModalIntent) => void;
  resetStartState: () => void;
  selectedSourceSessionId: string;
  selectedStartMode: AgentSessionStartMode;
  handleSelectSourceSession: (externalSessionId: string) => void;
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
    () =>
      intent ? [...getSessionLaunchAction(intent.launchActionId).allowedStartModes] : ["fresh"],
    [intent],
  );

  const existingSessionOptions = useMemo(
    () => intent?.existingSessionOptions ?? [],
    [intent?.existingSessionOptions],
  );

  const resetStartState = useCallback((): void => {
    setSelectedStartMode("fresh");
    setSelectedSourceSessionId("");
  }, []);

  const initializeStartState = useCallback((nextIntent: SessionStartModalIntent): void => {
    const nextState = resolveInitialStartState({
      launchActionId: nextIntent.launchActionId,
      existingSessionOptions: nextIntent.existingSessionOptions ?? [],
      initialStartMode: nextIntent.initialStartMode,
      initialSourceExternalSessionId: nextIntent.initialSourceExternalSessionId,
    });
    setSelectedStartMode(nextState.selectedStartMode);
    setSelectedSourceSessionId(nextState.selectedSourceSessionId);
  }, []);

  const applyReuseSourceSelection = useCallback(
    (sourceExternalSessionId: string): void => {
      const nextDraft = buildReuseSelectionDraft({
        catalog,
        options: existingSessionOptions,
        runtimeDefinitions,
        sourceExternalSessionId,
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

      const nextSourceSessionId = resolveValidSourceSessionId(
        existingSessionOptions,
        selectedSourceSessionId,
      );
      if (!nextSourceSessionId) {
        return;
      }

      setSelectedSourceSessionId(nextSourceSessionId);
      applyReuseSourceSelection(nextSourceSessionId);
    },
    [applyReuseSourceSelection, existingSessionOptions, selectedSourceSessionId],
  );

  const handleSelectSourceSession = useCallback(
    (externalSessionId: string): void => {
      const nextSourceSessionId = resolveValidSourceSessionId(
        existingSessionOptions,
        externalSessionId,
      );
      setSelectedSourceSessionId(nextSourceSessionId);
      if (selectedStartMode !== "reuse") {
        return;
      }
      if (!nextSourceSessionId) {
        return;
      }
      applyReuseSourceSelection(nextSourceSessionId);
    },
    [applyReuseSourceSelection, existingSessionOptions, selectedStartMode],
  );

  useEffect(() => {
    if (selectedStartMode !== "reuse") {
      return;
    }
    const nextSourceSessionId = resolveValidSourceSessionId(
      existingSessionOptions,
      selectedSourceSessionId,
    );
    if (!nextSourceSessionId) {
      return;
    }
    if (nextSourceSessionId !== selectedSourceSessionId) {
      setSelectedSourceSessionId(nextSourceSessionId);
    }
    applyReuseSourceSelection(nextSourceSessionId);
  }, [
    applyReuseSourceSelection,
    existingSessionOptions,
    selectedSourceSessionId,
    selectedStartMode,
  ]);

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
