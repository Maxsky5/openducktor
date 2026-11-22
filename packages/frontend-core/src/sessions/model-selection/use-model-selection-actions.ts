import type { RuntimeKind } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  resolveModelSelectionForPair,
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForVariantChange,
  canChangeLiveProfile,
  findCatalogModel,
  STANDARD_SPEED,
  withSpeed,
} from "@openducktor/core";
import { useCallback, useRef } from "react";
import type { ModelPickerValue } from "./model-picker-model";
import { useClientConnection } from "../../connection/client-connection-react";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import { reportModelUpdateError } from "./model-update-error";

type SelectionChange = (current: AgentModelSelection | null) => AgentModelSelection | null;
/** The newest selection of a session while its changes write, so quick changes build on it. */
type PendingSelectionUpdates = {
  selection: AgentModelSelection | null;
  pending: number;
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
  applyDraftSelection: (selection: AgentModelSelection | null) => void;
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
  const pendingUpdates = useRef(new Map<string, PendingSelectionUpdates>());
  const applySelection = useCallback(
    async (change: SelectionChange): Promise<void> => {
      if (!loadedSessionIdentity) {
        const selection = change(selectedModelSelection);
        if (selection) applyDraftSelection(selection);
        return;
      }
      const key = agentSessionIdentityKey(loadedSessionIdentity);
      const queues = pendingUpdates.current;
      const queue = queues.get(key) ?? { selection: selectedModelSelection, pending: 0 };
      const selection = change(queue.selection);
      if (!selection) return;
      // The change shows at once. The session writes it after the earlier changes.
      queue.selection = selection;
      queue.pending += 1;
      queues.set(key, queue);
      try {
        await updateAgentSessionModel(loadedSessionIdentity, selection);
      } finally {
        queue.pending -= 1;
        if (queue.pending === 0) queues.delete(key);
      }
    },
    [applyDraftSelection, loadedSessionIdentity, selectedModelSelection, updateAgentSessionModel],
  );

  const handleSelectAgentProfile = useCallback(
    (profileId: string) => {
      if (!effectiveRuntimeKind) {
        return;
      }
      void applySelection((currentSelection) => {
        const selectedModel = findCatalogModel(selectionCatalog, currentSelection);
        if (!canChangeLiveProfile(selectedModel, loadedSessionIdentity !== null)) {
          return null;
        }
        return resolveModelSelectionForProfileChange({
          catalog: selectionCatalog,
          currentSelection,
          profileId,
          runtimeKind: effectiveRuntimeKind,
        });
      }).catch(reportError);
    },
    [applySelection, effectiveRuntimeKind, loadedSessionIdentity, reportError, selectionCatalog],
  );

  const handleSelectModelPair = useCallback(
    (value: ModelPickerValue, targetCatalog: AgentModelCatalog): void => {
      if (loadedSessionIdentity && loadedSessionIdentity.runtimeKind !== value.runtimeKind) {
        return;
      }
      void applySelection((currentSelection) => {
        const resolvedPair = resolveModelSelectionForPair({
          catalog: targetCatalog,
          currentCatalog: selectionCatalog,
          currentSelection,
          defaultSelection: null,
          selectedModel: null,
          value,
        });
        if (!resolvedPair) {
          return null;
        }
        const nextSelection = resolvedPair.selection;
        if (currentSelection?.speed && !nextSelection.speed) {
          feedback.show(
            "info",
            "Speed was set to Standard because this model does not support the previous level.",
          );
        }
        return nextSelection;
      }).catch(reportError);
    },
    [applySelection, feedback, loadedSessionIdentity, reportError, selectionCatalog],
  );

  // The speed control reports its own failure, so this handler returns the update.
  const handleSelectSpeed = useCallback(
    (speed: string): Promise<void> =>
      applySelection((currentSelection) => {
        if (!currentSelection) return null;
        const selectedModel = findCatalogModel(selectionCatalog, currentSelection);
        if (
          selectedModel &&
          speed !== STANDARD_SPEED &&
          !selectedModel.speedLevels?.some((level) => level.id === speed)
        ) {
          throw new Error(
            "The selected model does not support this speed. Choose Standard or a supported speed.",
          );
        }
        return withSpeed(currentSelection, speed);
      }),
    [applySelection, selectionCatalog],
  );

  const handleSelectVariant = useCallback(
    (variant: string): Promise<void> =>
      applySelection((currentSelection) => {
        const selectedModel = findCatalogModel(selectionCatalog, currentSelection);
        if (loadedSessionIdentity && selectedModel && !selectedModel.variants.includes(variant)) {
          return null;
        }
        return resolveModelSelectionForVariantChange({
          catalog: selectionCatalog,
          currentSelection,
          variant,
        });
      }).catch(reportError),
    [applySelection, loadedSessionIdentity, reportError, selectionCatalog],
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
