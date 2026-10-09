import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionSpeedState,
  type RuntimeKind,
} from "@openducktor/contracts";
import {
  speedEligibility,
  initialSpeedState,
  modelSpeedLevels,
  type AgentModelCatalog,
  type AgentModelSelection,
} from "@openducktor/core";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SpeedControlModel } from "@/components/features/agents/speed-select";
import { errorMessage } from "@/lib/errors";

export function useSpeedControl({
  key,
  runtimeKind,
  catalog,
  model,
  choice,
  state: liveState,
  livePresence,
  disabled = false,
  onChange,
}: {
  key: string;
  runtimeKind: RuntimeKind | null;
  catalog: AgentModelCatalog | null;
  model: AgentModelSelection | null;
  choice: string | null;
  state?: AgentSessionSpeedState | undefined;
  livePresence: SpeedControlModel["livePresence"];
  disabled?: boolean;
  onChange: (choice: string) => Promise<void>;
}): SpeedControlModel | undefined {
  const [change, setChange] = useState<{
    key: string;
    choice: string;
    pending: boolean;
    error: string | null;
  } | null>(null);
  const isCurrent = change?.key === key;
  const changeChoice = (choice: string) => {
    const pending = { key, choice, pending: true, error: null };
    setChange(pending);
    void Promise.resolve()
      .then(() => onChange(choice))
      .then(
        () =>
          setChange((current) => (current === pending ? { ...pending, pending: false } : current)),
        (cause: unknown) =>
          setChange((current) =>
            current === pending
              ? { ...pending, pending: false, error: errorMessage(cause) }
              : current,
          ),
      );
  };
  const base = buildSpeedControl({
    key,
    runtimeKind,
    catalog,
    model,
    choice,
    disabled,
    onChange: changeChoice,
  });
  const levels = runtimeKind
    ? modelSpeedLevels(RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind], catalog, model)
    : undefined;
  const previous = useRef({ key, choice: liveState?.choice });
  useEffect(() => {
    if (
      liveState &&
      previous.current.key === key &&
      previous.current.choice != null &&
      previous.current.choice !== "standard" &&
      liveState.choice === "standard" &&
      levels !== undefined &&
      !levels.some((level) => level.id === previous.current.choice)
    )
      toast.info(
        "Speed was set to Standard because this model does not support the previous level.",
      );
    previous.current = { key, choice: liveState?.choice };
  }, [key, liveState, levels]);
  if (!base) return undefined;
  const state =
    liveState &&
    catalog?.speedAvailability?.status === "blocked" &&
    liveState.availability.status === "unknown"
      ? { ...liveState, availability: catalog.speedAvailability }
      : liveState;
  const currentState = state ?? base.state;
  return {
    ...base,
    livePresence,
    state: isCurrent && change.pending ? { ...currentState, choice: change.choice } : currentState,
    pending: isCurrent && change.pending,
    error: isCurrent ? change.error : null,
  };
}

export function buildSpeedControl({
  key,
  runtimeKind,
  catalog,
  model,
  choice,
  disabled,
  onChange,
}: {
  key: string;
  runtimeKind: RuntimeKind | null;
  catalog: AgentModelCatalog | null;
  model: AgentModelSelection | null;
  choice: string | null;
  disabled: boolean;
  onChange: (choice: string) => void;
}): SpeedControlModel | undefined {
  if (
    !runtimeKind ||
    RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].capabilities.speed.support === "none"
  )
    return undefined;
  return {
    key,
    livePresence: "absent",
    eligibility: speedEligibility(RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind], catalog, model),
    levels: modelSpeedLevels(RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind], catalog, model),
    state: {
      ...initialSpeedState(choice, "confirmed"),
      availability: catalog?.speedAvailability ?? { status: "unknown" },
    },
    pending: false,
    disabled,
    error: null,
    onChange,
  };
}
