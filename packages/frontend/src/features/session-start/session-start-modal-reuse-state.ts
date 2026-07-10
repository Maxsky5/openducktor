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
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
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
  sourceSession: AgentSessionIdentity | null | undefined,
): string => {
  if (!sourceSession) {
    return firstSourceSessionValue(options);
  }

  const matchingOption = options.find((option) =>
    matchesAgentSessionIdentity(option.sourceSession, sourceSession),
  );

  return matchingOption?.value ?? firstSourceSessionValue(options);
};

const resolveInitialStartState = ({
  existingSessionOptions,
  initialSourceSession,
  initialStartMode,
  launchActionId,
}: {
  existingSessionOptions: SessionStartExistingSessionOption[];
  initialSourceSession: AgentSessionIdentity | null | undefined;
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
      initialSourceSession,
    ),
  };
};

const buildSourceSelectionDraft = ({
  catalog,
  options,
  runtimeDefinitions,
  startMode,
  sourceSessionValue,
}: {
  catalog: AgentModelCatalog | null;
  options: SessionStartExistingSessionOption[];
  runtimeDefinitions: RuntimeDescriptor[];
  startMode: "reuse" | "fork";
  sourceSessionValue: string;
}): {
  runtimeKind: RuntimeKind | null;
  selection: AgentModelSelection | null;
} => {
  const sourceSelection = resolveSourceSelection(options, sourceSessionValue);
  const runtimeKind = resolveRuntimeKindSelection({
    runtimeDefinitions: filterRuntimeDefinitionsForStartMode(runtimeDefinitions, startMode),
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

  const applySourceSessionSelection = useCallback(
    (
      startMode: "reuse" | "fork",
      sourceSessionValue: string,
      options = existingSessionOptions,
    ): void => {
      const nextDraft = buildSourceSelectionDraft({
        catalog,
        options,
        runtimeDefinitions,
        startMode,
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
        initialSourceSession: nextIntent.initialSourceSession,
      });
      setSelectedStartMode(nextState.selectedStartMode);
      setSelectedSourceSessionValue(nextState.selectedSourceSessionValue);
      if (nextState.selectedStartMode === "reuse" || nextState.selectedStartMode === "fork") {
        applySourceSessionSelection(
          nextState.selectedStartMode,
          nextState.selectedSourceSessionValue,
          nextIntent.existingSessionOptions ?? [],
        );
      }
      return nextState;
    },
    [applySourceSessionSelection],
  );

  const effectiveSelectedSourceSessionValue =
    effectiveSelectedStartMode === "reuse" || effectiveSelectedStartMode === "fork"
      ? resolveSelectedSourceSessionValue(existingSessionOptions, selectedSourceSessionValue)
      : selectedSourceSessionValue;

  const reuseSelectionDraft = useMemo(
    () =>
      effectiveSelectedStartMode === "reuse" && effectiveSelectedSourceSessionValue
        ? buildSourceSelectionDraft({
            catalog,
            options: existingSessionOptions,
            runtimeDefinitions,
            startMode: "reuse",
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
      if (startMode !== "reuse" && startMode !== "fork") {
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
      applySourceSessionSelection(startMode, nextSourceSessionValue);
    },
    [applySourceSessionSelection, existingSessionOptions, selectedSourceSessionValue],
  );

  const handleSelectSourceSessionValue = useCallback(
    (sourceSessionValue: string): void => {
      const nextSourceSessionValue = resolveSelectedSourceSessionValue(
        existingSessionOptions,
        sourceSessionValue,
      );
      setSelectedSourceSessionValue(nextSourceSessionValue);
      if (effectiveSelectedStartMode !== "reuse" && effectiveSelectedStartMode !== "fork") {
        return;
      }
      if (!nextSourceSessionValue) {
        return;
      }
      applySourceSessionSelection(effectiveSelectedStartMode, nextSourceSessionValue);
    },
    [applySourceSessionSelection, effectiveSelectedStartMode, existingSessionOptions],
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
