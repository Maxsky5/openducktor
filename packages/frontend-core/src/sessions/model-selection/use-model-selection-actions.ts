import type { RuntimeKind } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  canChangeLiveProfile,
  findCatalogModel,
  isSelectableCatalogProfileId,
  resolveModelSelectionForPair,
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForVariantChange,
  resolveSavedModelAlias,
  STANDARD_SPEED,
  withSpeed,
} from "@openducktor/core";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { ModelPickerValue } from "./model-picker-model";
import { SPEED_RESET_TO_STANDARD_NOTICE } from "./model-picker-presentation";
import { reportModelUpdateError } from "./model-update-error";

type SelectionChange = (
  current: AgentModelSelection | null,
  catalog: AgentModelCatalog | null,
) => {
  selection: AgentModelSelection;
  catalog?: AgentModelCatalog | null | undefined;
  onAccepted?: (() => void) | undefined;
} | null;

const isSameSelectionModelPair = (
  currentSelection: AgentModelSelection | null,
  value: ModelPickerValue,
  targetCatalog: AgentModelCatalog,
): boolean => {
  if (!currentSelection || currentSelection.runtimeKind !== value.runtimeKind) {
    return false;
  }
  if (
    currentSelection.providerId === value.providerId &&
    currentSelection.modelId === value.modelId
  ) {
    return true;
  }
  const canonicalCurrent = resolveSavedModelAlias(targetCatalog, currentSelection);
  const canonicalTarget = resolveSavedModelAlias(targetCatalog, value);
  return (
    canonicalCurrent.providerId === canonicalTarget.providerId &&
    canonicalCurrent.modelId === canonicalTarget.modelId
  );
};

export const useModelSelectionActions = ({
  loadedSessionIdentity,
  updateAgentSessionModel,
  applyDraftSelection,
  selectedModelSelection,
  selectionCatalog,
  selectedRuntimeKind,
}: {
  loadedSessionIdentity: AgentSessionIdentity | null;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => Promise<void> | void;
  applyDraftSelection: (selection: AgentModelSelection | null) => Promise<void> | void;
  selectedModelSelection: AgentModelSelection | null;
  selectionCatalog: AgentModelCatalog | null;
  selectedRuntimeKind: RuntimeKind | null;
}) => {
  const { feedback } = useClientConnection();
  const effectiveRuntimeKind = loadedSessionIdentity?.runtimeKind ?? selectedRuntimeKind;
  const reportError = useCallback(
    (cause: unknown): void => reportModelUpdateError(feedback, cause),
    [feedback],
  );
  // The newest selection and catalog, so a quick second change builds on the first before the next render.
  const latestSelection = useRef(selectedModelSelection);
  const latestCatalog = useRef(selectionCatalog);
  const sessionKey = loadedSessionIdentity ? agentSessionIdentityKey(loadedSessionIdentity) : null;
  useLayoutEffect(() => {
    latestSelection.current = selectedModelSelection;
    latestCatalog.current = selectionCatalog;
  }, [selectedModelSelection, selectionCatalog, sessionKey]);

  const applySelection = useCallback(
    async (change: SelectionChange): Promise<void> => {
      const previousSelection = latestSelection.current;
      const previousCatalog = latestCatalog.current;
      const resolved = change(previousSelection, previousCatalog);
      if (!resolved) return;
      latestSelection.current = resolved.selection;
      if (resolved.catalog !== undefined) {
        latestCatalog.current = resolved.catalog;
      }
      try {
        if (!loadedSessionIdentity) {
          await applyDraftSelection(resolved.selection);
        } else {
          // The change shows at once. The session writes it after the earlier changes.
          await updateAgentSessionModel(loadedSessionIdentity, resolved.selection);
        }
      } catch (error) {
        if (latestSelection.current === resolved.selection) {
          latestSelection.current = previousSelection;
          latestCatalog.current = previousCatalog;
        }
        throw error;
      }
      resolved.onAccepted?.();
    },
    [applyDraftSelection, loadedSessionIdentity, updateAgentSessionModel],
  );

  const handleSelectAgentProfile = useCallback(
    (profileId: string) => {
      if (!effectiveRuntimeKind) {
        return;
      }
      void applySelection((currentSelection, currentCatalog) => {
        const normalizedProfileId = profileId.trim();
        if (!currentSelection || !normalizedProfileId) {
          return null;
        }
        if (currentSelection.profileId === normalizedProfileId) {
          return null;
        }
        const selectedModel = findCatalogModel(currentCatalog, currentSelection);
        if (!canChangeLiveProfile(selectedModel, loadedSessionIdentity !== null)) {
          return null;
        }
        if (currentCatalog && !isSelectableCatalogProfileId(currentCatalog, normalizedProfileId)) {
          throw new Error(
            "The selected agent profile is no longer available. Choose an available agent profile.",
          );
        }
        const nextSelection = resolveModelSelectionForProfileChange({
          catalog: currentCatalog,
          currentSelection,
          profileId: normalizedProfileId,
          runtimeKind: effectiveRuntimeKind,
        });
        return nextSelection ? { selection: nextSelection } : null;
      }).catch(reportError);
    },
    [applySelection, effectiveRuntimeKind, loadedSessionIdentity, reportError],
  );

  const handleSelectModelPair = useCallback(
    (value: ModelPickerValue, targetCatalog: AgentModelCatalog): void => {
      if (loadedSessionIdentity && loadedSessionIdentity.runtimeKind !== value.runtimeKind) {
        return;
      }
      void applySelection((currentSelection, currentCatalog) => {
        if (isSameSelectionModelPair(currentSelection, value, targetCatalog)) {
          return null;
        }
        const resolvedPair = resolveModelSelectionForPair({
          catalog: targetCatalog,
          currentCatalog,
          currentSelection,
          defaultSelection: null,
          selectedModel: null,
          value,
        });
        if (!resolvedPair) {
          return null;
        }
        const nextSelection = resolvedPair.selection;
        const speedResetToStandard = Boolean(currentSelection?.speed && !nextSelection.speed);
        return {
          selection: nextSelection,
          catalog: targetCatalog,
          onAccepted: speedResetToStandard
            ? () => {
                feedback.show("info", SPEED_RESET_TO_STANDARD_NOTICE);
              }
            : undefined,
        };
      }).catch(reportError);
    },
    [applySelection, feedback, loadedSessionIdentity, reportError],
  );

  // The speed control reports its own failure, so this handler returns the update.
  const handleSelectSpeed = useCallback(
    (speed: string): Promise<void> =>
      applySelection((currentSelection, currentCatalog) => {
        if (!currentSelection) return null;
        const selectedModel = findCatalogModel(currentCatalog, currentSelection);
        if (
          selectedModel &&
          speed !== STANDARD_SPEED &&
          !selectedModel.speedLevels?.some((level) => level.id === speed)
        ) {
          throw new Error(
            "The selected model does not support this speed. Choose Standard or a supported speed.",
          );
        }
        const nextSelection = withSpeed(currentSelection, speed);
        return nextSelection ? { selection: nextSelection } : null;
      }),
    [applySelection],
  );

  const handleSelectVariant = useCallback(
    (variant: string): Promise<void> =>
      applySelection((currentSelection, currentCatalog) => {
        if (!currentSelection || currentSelection.variant === variant) {
          return null;
        }
        const selectedModel = findCatalogModel(currentCatalog, currentSelection);
        if (loadedSessionIdentity && selectedModel && !selectedModel.variants.includes(variant)) {
          return null;
        }
        const nextSelection = resolveModelSelectionForVariantChange({
          catalog: currentCatalog,
          currentSelection,
          variant,
        });
        return nextSelection ? { selection: nextSelection } : null;
      }).catch(reportError),
    [applySelection, loadedSessionIdentity, reportError],
  );

  return {
    handleSelectAgentProfile,
    handleSelectModelPair,
    handleSelectVariant,
    handleSelectSpeed,
  } satisfies {
    handleSelectAgentProfile: (profileId: string) => void;
    handleSelectModelPair: (value: ModelPickerValue, targetCatalog: AgentModelCatalog) => void;
    /** Settles after the change applies or after its failure is reported. */
    handleSelectVariant: (variant: string) => Promise<void>;
    handleSelectSpeed: (speed: string) => Promise<void>;
  };
};
