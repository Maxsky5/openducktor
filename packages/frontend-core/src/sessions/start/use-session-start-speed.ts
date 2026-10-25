import { useEffect, useState } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import { findCatalogModel, STANDARD_SPEED, withSpeed } from "../../lib/model-catalog-selection";
import { selectableModelPickerCatalog } from "../model-selection/model-picker-model";
import { type SpeedControlModel, useSpeedControl } from "../model-selection/use-speed-control";
import type { SessionStartModalModel } from "./session-start-modal-model";

type SessionStartSpeed = {
  /** Null when the selected runtime cannot change speed. */
  control: SpeedControlModel | null;
  /** The speed to send with the start, or undefined to keep the default. */
  change: string | undefined;
};

/**
 * A reused session keeps its speed. A fresh or forked session starts at standard speed.
 * The start sends a speed only when the user changes it.
 */
export function useSessionStartSpeed(model: SessionStartModalModel): SessionStartSpeed {
  const { feedback } = useClientConnection();
  const { selectedStartMode, selectedSourceSessionValue, selectedModelSelection } = model;
  const key = `${model.requestId ?? model.open}|${selectedStartMode}|${selectedSourceSessionValue}`;
  const source =
    selectedStartMode === "reuse"
      ? model.existingSessionOptions.find((option) => option.value === selectedSourceSessionValue)
      : undefined;
  const initial = source?.selectedModel?.speed ?? STANDARD_SPEED;
  const [draft, setDraft] = useState({ key, choice: initial });
  const choice = draft.key === key ? draft.choice : initial;
  const catalog = selectableModelPickerCatalog(
    model.modelPickerRuntimes.find(
      (runtime) => runtime.descriptor.kind === model.selectedRuntimeKind,
    )?.resource,
  );
  const catalogModel =
    catalog && selectedModelSelection ? findCatalogModel(catalog, selectedModelSelection) : null;
  const unsupported =
    choice !== STANDARD_SPEED &&
    catalogModel !== null &&
    !catalogModel.speedLevels?.some((level) => level.id === choice);
  useEffect(() => {
    if (!unsupported) return;
    setDraft({ key, choice: STANDARD_SPEED });
    feedback.show(
      "info",
      "Speed was set to Standard because this model does not support the previous level.",
    );
  }, [feedback, key, unsupported]);
  const control = useSpeedControl({
    key,
    runtimeKind: model.selectedRuntimeKind,
    catalog,
    selection: selectedModelSelection && withSpeed(selectedModelSelection, choice),
    disabled: model.isStarting,
    onSelect: (next) => setDraft({ key, choice: next }),
  });
  return { control, change: choice === initial ? undefined : choice };
}
