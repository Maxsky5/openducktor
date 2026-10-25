import type { RuntimeKind } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  resolveModelSelectionForPair,
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForVariantChange,
  resolveModelSelectionPolicy,
} from "@openducktor/core";
import { useCallback, useRef } from "react";
import type { ModelPickerValue } from "./model-picker-model";
import { useClientConnection } from "../../connection/client-connection-react";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import { STANDARD_SPEED, withSpeed } from "../../lib/model-catalog-selection";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";
import { reportModelUpdateError } from "./model-update-error";

type SelectionChange = (current: AgentModelSelection | null) => AgentModelSelection | null;
type PendingSelectionUpdates = {
  selection: AgentModelSelection | null;
  settled: Promise<void>;
};

const findSelectedCatalogModel = (
  catalog: AgentModelCatalog | null,
  selection: AgentModelSelection | null,
) => {
  if (!catalog || !selection) {
    return null;
  }
  return (
    catalog.models.find(
      (model) => model.providerId === selection.providerId && model.modelId === selection.modelId,
    ) ?? null
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
      const queue = queues.get(key) ?? {
        selection: selectedModelSelection,
        settled: Promise.resolve(),
      };
      queues.set(key, queue);

      // Resolve each change after the prior write, using only accepted selections.
      const update = queue.settled.then(async () => {
        const selection = change(queue.selection);
        if (!selection) return;
        await updateAgentSessionModel(loadedSessionIdentity, selection);
        queue.selection = selection;
      });
      // A rejected write still reaches its caller. It must not poison the next change.
      const settled = update.then(
        () => {},
        () => {},
      );
      queue.settled = settled;
      void settled.then(() => {
        if (queue.settled === settled) queues.delete(key);
      });
      await update;
    },
    [applyDraftSelection, loadedSessionIdentity, selectedModelSelection, updateAgentSessionModel],
  );

  const handleSelectAgentProfile = useCallback(
    (profileId: string) => {
      if (!effectiveRuntimeKind) {
        return;
      }
      void applySelection((currentSelection) => {
        const selectedModel = findSelectedCatalogModel(selectionCatalog, currentSelection);
        if (
          !resolveModelSelectionPolicy(selectedModel, loadedSessionIdentity !== null)
            .canChangeProfile
        ) {
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
          currentSelection,
          defaultSelection: null,
          selectedModel: null,
          value,
        });
        if (!resolvedPair) {
          return null;
        }
        const { model, selection: modelSelection } = resolvedPair;
        const { variants } = resolveModelSelectionPolicy(model, loadedSessionIdentity !== null);
        const { variant: _defaultVariant, ...selectionWithoutVariant } = modelSelection;
        const nextSelection: AgentModelSelection = { ...selectionWithoutVariant };
        if (variants[0]) {
          nextSelection.variant = variants[0];
        }
        if (currentSelection?.speed && !nextSelection.speed) {
          feedback.show(
            "info",
            "Speed was set to Standard because this model does not support the previous level.",
          );
        }
        return nextSelection;
      }).catch(reportError);
    },
    [applySelection, feedback, loadedSessionIdentity, reportError],
  );

  // The speed control reports its own failure, so this handler returns the update.
  const handleSelectSpeed = useCallback(
    (speed: string): Promise<void> =>
      applySelection((currentSelection) => {
        if (!currentSelection) return null;
        const selectedModel = findSelectedCatalogModel(selectionCatalog, currentSelection);
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
        const selectedModel = findSelectedCatalogModel(selectionCatalog, currentSelection);
        const policy = resolveModelSelectionPolicy(selectedModel, loadedSessionIdentity !== null);
        if (loadedSessionIdentity && selectedModel && !policy.variants.includes(variant)) {
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
