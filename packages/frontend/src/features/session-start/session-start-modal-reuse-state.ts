import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionStartMode,
} from "@openducktor/core";
import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";
import {
  filterRuntimeDefinitionsForStartMode,
  resolveRuntimeKindSelection,
} from "@/lib/agent-runtime";
import { getSessionLaunchAction, type SessionLaunchActionId } from "./session-start-launch-options";
import type { SessionStartModalIntent } from "./session-start-modal-types";
import { resolveLaunchStartMode } from "./session-start-mode";
import { coerceVisibleSelectionToCatalog, isSameSelection } from "./session-start-selection";
import type { SessionStartExistingSessionOption } from "./session-start-types";

const EMPTY_EXISTING_SESSION_OPTIONS: SessionStartExistingSessionOption[] = [];

const resolveSourceSelection = (
  options: SessionStartExistingSessionOption[],
  sourceSessionValue: string,
): AgentModelSelection | null => {
  if (!sourceSessionValue) {
    return null;
  }

  const selectedOption = options.find((option) => option.value === sourceSessionValue);
  return selectedOption?.selectedModel ?? null;
};

const firstSourceSessionValue = (options: SessionStartExistingSessionOption[]): string =>
  options[0]?.value ?? "";

const resolveSelectedSourceSessionValue = (
  options: SessionStartExistingSessionOption[],
  sourceSessionValue: string | null | undefined,
): string => {
  const normalizedSourceSessionValue = sourceSessionValue?.trim() ?? "";
  if (!normalizedSourceSessionValue) {
    return firstSourceSessionValue(options);
  }

  const matchingOption = options.find((option) => option.value === normalizedSourceSessionValue);

  return matchingOption?.value ?? firstSourceSessionValue(options);
};

const resolveInitialSourceSessionValue = (
  options: SessionStartExistingSessionOption[],
  sourceExternalSessionId: string | null | undefined,
): string => {
  const normalizedExternalSessionId = sourceExternalSessionId?.trim() ?? "";
  if (!normalizedExternalSessionId) {
    return firstSourceSessionValue(options);
  }

  const matchingOption = options.find(
    (option) => option.sourceExternalSessionId === normalizedExternalSessionId,
  );

  return matchingOption?.value ?? firstSourceSessionValue(options);
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
  selectedSourceSessionValue: string;
  selectedStartMode: AgentSessionStartMode;
} => {
  const allowedStartModes = getSessionLaunchAction(launchActionId).allowedStartModes;
  const hasExistingSession = existingSessionOptions.length > 0;
  let selectedStartMode: AgentSessionStartMode;

  if (initialStartMode && allowedStartModes.includes(initialStartMode)) {
    selectedStartMode = initialStartMode;
    if (
      (selectedStartMode === "reuse" || selectedStartMode === "fork") &&
      !hasExistingSession &&
      allowedStartModes.includes("fresh")
    ) {
      selectedStartMode = "fresh";
    }
  } else {
    selectedStartMode = resolveLaunchStartMode({
      launchActionId,
      existingSessionOptions,
    });
  }

  return {
    selectedStartMode,
    selectedSourceSessionValue: resolveInitialSourceSessionValue(
      existingSessionOptions,
      initialSourceExternalSessionId,
    ),
  };
};

const buildReuseSelectionDraft = ({
  catalog,
  options,
  runtimeDefinitions,
  sourceSessionValue,
}: {
  catalog: AgentModelCatalog | null;
  options: SessionStartExistingSessionOption[];
  runtimeDefinitions: RuntimeDescriptor[];
  sourceSessionValue: string;
}): {
  runtimeKind: RuntimeKind | null;
  selection: AgentModelSelection | null;
} => {
  const sourceSelection = resolveSourceSelection(options, sourceSessionValue);
  const runtimeKind = resolveRuntimeKindSelection({
    runtimeDefinitions: filterRuntimeDefinitionsForStartMode(runtimeDefinitions, "reuse"),
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
  initializeStartState: (intent: SessionStartModalIntent) => {
    selectedSourceSessionValue: string;
    selectedStartMode: AgentSessionStartMode;
  };
  resetStartState: () => void;
  reuseSelection: AgentModelSelection | null;
  selectedSourceSessionValue: string;
  selectedStartMode: AgentSessionStartMode;
  handleSelectSourceSessionValue: (sourceSessionValue: string) => void;
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
  const [selectedSourceSessionValue, setSelectedSourceSessionValue] = useState("");

  const availableStartModes = useMemo<AgentSessionStartMode[]>(
    () =>
      intent ? [...getSessionLaunchAction(intent.launchActionId).allowedStartModes] : ["fresh"],
    [intent],
  );

  const existingSessionOptions = intent?.existingSessionOptions ?? EMPTY_EXISTING_SESSION_OPTIONS;
  const selectedStartModeHasSource = selectedStartMode === "reuse" || selectedStartMode === "fork";
  const effectiveSelectedStartMode =
    selectedStartModeHasSource &&
    existingSessionOptions.length === 0 &&
    availableStartModes.includes("fresh")
      ? "fresh"
      : selectedStartMode;

  const resetStartState = useCallback((): void => {
    setSelectedStartMode("fresh");
    setSelectedSourceSessionValue("");
  }, []);

  const applyReuseSourceSelection = useCallback(
    (sourceSessionValue: string, options = existingSessionOptions): void => {
      const nextDraft = buildReuseSelectionDraft({
        catalog,
        options,
        runtimeDefinitions,
        sourceSessionValue,
      });
      setRequestedRuntimeKind(nextDraft.runtimeKind);
      setSelection((current) =>
        isSameSelection(current, nextDraft.selection) ? current : nextDraft.selection,
      );
    },
    [catalog, existingSessionOptions, runtimeDefinitions, setRequestedRuntimeKind, setSelection],
  );

  const initializeStartState = useCallback(
    (
      nextIntent: SessionStartModalIntent,
    ): {
      selectedSourceSessionValue: string;
      selectedStartMode: AgentSessionStartMode;
    } => {
      const nextState = resolveInitialStartState({
        launchActionId: nextIntent.launchActionId,
        existingSessionOptions: nextIntent.existingSessionOptions ?? [],
        initialStartMode: nextIntent.initialStartMode,
        initialSourceExternalSessionId: nextIntent.initialSourceExternalSessionId,
      });
      setSelectedStartMode(nextState.selectedStartMode);
      setSelectedSourceSessionValue(nextState.selectedSourceSessionValue);
      if (nextState.selectedStartMode === "reuse") {
        applyReuseSourceSelection(
          nextState.selectedSourceSessionValue,
          nextIntent.existingSessionOptions ?? [],
        );
      }
      return nextState;
    },
    [applyReuseSourceSelection],
  );

  const effectiveSelectedSourceSessionValue =
    effectiveSelectedStartMode === "reuse"
      ? resolveSelectedSourceSessionValue(existingSessionOptions, selectedSourceSessionValue)
      : selectedSourceSessionValue;

  const reuseSelectionDraft = useMemo(
    () =>
      effectiveSelectedStartMode === "reuse" && effectiveSelectedSourceSessionValue
        ? buildReuseSelectionDraft({
            catalog,
            options: existingSessionOptions,
            runtimeDefinitions,
            sourceSessionValue: effectiveSelectedSourceSessionValue,
          })
        : {
            runtimeKind: null,
            selection: null,
          },
    [
      catalog,
      effectiveSelectedSourceSessionValue,
      effectiveSelectedStartMode,
      existingSessionOptions,
      runtimeDefinitions,
    ],
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

      const nextSourceSessionValue = resolveSelectedSourceSessionValue(
        existingSessionOptions,
        selectedSourceSessionValue,
      );
      if (!nextSourceSessionValue) {
        return;
      }

      setSelectedSourceSessionValue(nextSourceSessionValue);
      applyReuseSourceSelection(nextSourceSessionValue);
    },
    [applyReuseSourceSelection, existingSessionOptions, selectedSourceSessionValue],
  );

  const handleSelectSourceSessionValue = useCallback(
    (sourceSessionValue: string): void => {
      const nextSourceSessionValue = resolveSelectedSourceSessionValue(
        existingSessionOptions,
        sourceSessionValue,
      );
      setSelectedSourceSessionValue(nextSourceSessionValue);
      if (effectiveSelectedStartMode !== "reuse") {
        return;
      }
      if (!nextSourceSessionValue) {
        return;
      }
      applyReuseSourceSelection(nextSourceSessionValue);
    },
    [applyReuseSourceSelection, effectiveSelectedStartMode, existingSessionOptions],
  );

  return {
    availableStartModes,
    existingSessionOptions,
    initializeStartState,
    resetStartState,
    reuseSelection: reuseSelectionDraft.selection,
    selectedSourceSessionValue: effectiveSelectedSourceSessionValue,
    selectedStartMode: effectiveSelectedStartMode,
    handleSelectSourceSessionValue,
    handleSelectStartMode,
  };
}
