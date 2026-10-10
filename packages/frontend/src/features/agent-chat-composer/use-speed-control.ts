import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useState } from "react";
import type { SpeedControlModel } from "@/components/features/agents/speed-select";
import { errorMessage } from "@/lib/errors";
import { findCatalogModel, STANDARD_SPEED } from "@/lib/model-catalog-selection";

type SpeedChange = { key: string; choice: string; pending: boolean; error: string | null };

/** Returns no control when the runtime cannot change speed. */
export function useSpeedControl({
  key,
  runtimeKind,
  catalog,
  selection,
  disabled,
  onSelect,
}: {
  key: string;
  runtimeKind: RuntimeKind | null;
  catalog: AgentModelCatalog | null;
  selection: AgentModelSelection | null;
  disabled: boolean;
  onSelect: (speed: string) => Promise<void> | void;
}): SpeedControlModel | undefined {
  const [change, setChange] = useState<SpeedChange | null>(null);
  if (
    !runtimeKind ||
    RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].capabilities.speed.support === "none"
  )
    return undefined;
  const current = change?.key === key ? change : null;
  const model = catalog && selection ? findCatalogModel(catalog, selection) : null;
  const availability = catalog?.speedAvailability;
  return {
    key,
    choice: current?.pending ? current.choice : (selection?.speed ?? STANDARD_SPEED),
    levels: model?.speedLevels ?? [],
    blockedReason: availability?.status === "blocked" ? availability.reason.message : undefined,
    pending: current?.pending ?? false,
    disabled,
    error: current?.error ?? null,
    onChange: (choice) => {
      const next: SpeedChange = { key, choice, pending: true, error: null };
      setChange(next);
      void Promise.resolve()
        .then(() => onSelect(choice))
        .then(
          () => setChange((value) => (value === next ? null : value)),
          (cause: unknown) =>
            setChange((value) =>
              value === next ? { ...next, pending: false, error: errorMessage(cause) } : value,
            ),
        );
    },
  };
}
