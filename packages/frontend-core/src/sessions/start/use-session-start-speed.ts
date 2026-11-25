import { useEffect, useRef, useState } from "react";
import { useClientConnection } from "../../connection/client-connection-react";
import {
  findCatalogModel,
  findMatchingCatalogSpeed,
  resolveSavedModelAlias,
  type SpeedPreference,
  STANDARD_SPEED,
  withSpeed,
} from "@openducktor/core";
import { selectableModelPickerCatalog } from "../model-selection/model-picker-model";
import { blockedSpeedReason } from "../model-selection/model-picker-presentation";
import { type SpeedControlModel, useSpeedControl } from "../model-selection/use-speed-control";
import type { SessionStartModalModel } from "./session-start-modal-model";

export type SessionStartSpeed = {
  /** Null when the selected runtime cannot change speed. */
  control: SpeedControlModel | null;
  /** The effective speed choice (`standard` or a level ID). */
  effectiveSpeed: string;
  /** The speed to send on a reuse start, or undefined when unchanged from the source session. */
  reuseSpeedChange: string | undefined;
  /** Account speed block reason when a non-standard speed is active, or null. */
  blockedReason: string | null;
};

type SpeedDraft = { key: string; choice: SpeedPreference; resetNoticeKey?: string };

const resolveSessionStartSpeedState = (model: SessionStartModalModel, draft: SpeedDraft | null) => {
  const { selectedStartMode, selectedSourceSessionValue, selectedModelSelection } = model;
  const key = `${model.requestId ?? model.open}|${selectedStartMode}|${selectedSourceSessionValue}`;
  const isReuseMode = selectedStartMode === "reuse";
  const source = isReuseMode
    ? model.existingSessionOptions.find((option) => option.value === selectedSourceSessionValue)
    : undefined;
  const initial = isReuseMode
    ? (source?.selectedModel?.speed ?? STANDARD_SPEED)
    : selectedStartMode === "fresh"
      ? (model.initialFreshSpeed ?? STANDARD_SPEED)
      : STANDARD_SPEED;
  const activeDraft = draft?.key === key ? draft : null;
  const preference: SpeedPreference = activeDraft?.choice ?? { id: initial };
  const catalog = selectableModelPickerCatalog(
    model.modelPickerRuntimes.find(
      (runtime) => runtime.descriptor.kind === model.selectedRuntimeKind,
    )?.resource,
  );
  const catalogModel =
    catalog && selectedModelSelection
      ? findCatalogModel(catalog, resolveSavedModelAlias(catalog, selectedModelSelection))
      : null;
  const matchedLevel = catalogModel
    ? findMatchingCatalogSpeed(catalogModel, preference)
    : undefined;
  const unsupported =
    !isReuseMode && preference.id !== STANDARD_SPEED && catalogModel !== null && !matchedLevel;
  const choice = matchedLevel?.id ?? (unsupported ? STANDARD_SPEED : preference.id);
  let nextDraft: SpeedDraft | null = null;
  let unsupportedNoticeKey: string | null = activeDraft?.resetNoticeKey ?? null;
  if (unsupported) {
    const resetNoticeKey = `${key}|${selectedModelSelection?.runtimeKind ?? ""}|${selectedModelSelection?.providerId ?? ""}|${selectedModelSelection?.modelId ?? ""}|${preference.id}`;
    unsupportedNoticeKey = resetNoticeKey;
    nextDraft = { key, choice: { id: STANDARD_SPEED }, resetNoticeKey };
  } else if (
    !isReuseMode &&
    matchedLevel !== undefined &&
    preference.label !== matchedLevel.label
  ) {
    nextDraft = { key, choice: { id: matchedLevel.id, label: matchedLevel.label } };
  }

  return {
    key,
    initial,
    isReuseMode,
    catalog,
    catalogModel,
    choice,
    nextDraft,
    unsupportedNoticeKey,
  };
};

/**
 * A reused session keeps its speed verbatim (including unlisted speeds) until changed.
 * A fresh session inherits its initial default speed, and a forked session starts at Standard.
 * A model change in fresh or fork mode keeps a speed level with the same ID or label across runtimes.
 */
export function useSessionStartSpeed(model: SessionStartModalModel): SessionStartSpeed {
  const { feedback } = useClientConnection();
  const [draft, setDraft] = useState<SpeedDraft | null>(null);
  const notifiedUnsupportedRef = useRef<string | null>(null);
  const resolved = resolveSessionStartSpeedState(model, draft);

  if (resolved.nextDraft) {
    setDraft(resolved.nextDraft);
  }

  useEffect(() => {
    const noticeKey = resolved.unsupportedNoticeKey;
    if (!noticeKey || notifiedUnsupportedRef.current === noticeKey) {
      return;
    }
    notifiedUnsupportedRef.current = noticeKey;
    feedback.show(
      "info",
      "Speed was set to Standard because this model does not support the previous level.",
    );
  }, [feedback, resolved.unsupportedNoticeKey]);

  const control = useSpeedControl({
    key: resolved.key,
    runtimeKind: model.selectedRuntimeKind,
    catalog: resolved.catalog,
    selection:
      model.selectedModelSelection && withSpeed(model.selectedModelSelection, resolved.choice),
    disabled: model.isStarting,
    onSelect: (next) =>
      setDraft({
        key: resolved.key,
        choice: resolved.catalogModel?.speedLevels?.find((level) => level.id === next) ?? {
          id: next,
        },
      }),
  });
  return {
    control,
    effectiveSpeed: resolved.choice,
    reuseSpeedChange:
      resolved.isReuseMode && resolved.choice !== resolved.initial ? resolved.choice : undefined,
    blockedReason: blockedSpeedReason(control),
  };
}
