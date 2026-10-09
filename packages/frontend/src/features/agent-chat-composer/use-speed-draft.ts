import type { RuntimeKind } from "@openducktor/contracts";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import {
  modelSpeedLevels,
  type AgentModelCatalog,
  type AgentModelSelection,
} from "@openducktor/core";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { buildSpeedControl } from "./use-speed-control";

export function useSpeedDraft(
  key: string,
  runtimeKind: RuntimeKind | null,
  catalog: AgentModelCatalog | null,
  model: AgentModelSelection | null,
  initialChoice: string | null = "standard",
) {
  const [draft, setDraft] = useState({ key, runtimeKind, choice: initialChoice });
  const current =
    draft.key === key && draft.runtimeKind === runtimeKind
      ? draft
      : { key, runtimeKind, choice: initialChoice };
  const levels = runtimeKind
    ? modelSpeedLevels(RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind], catalog, model)
    : undefined;
  const reset =
    current.choice !== null &&
    current.choice !== "standard" &&
    levels !== undefined &&
    !levels.some((level) => level.id === current.choice);
  const next = reset ? { ...current, choice: "standard" } : current;
  if (next !== draft) setDraft(next);
  const choice = next.choice;
  const previous = useRef({ key, runtimeKind, choice });
  useEffect(() => {
    if (
      previous.current.key === key &&
      previous.current.runtimeKind === runtimeKind &&
      previous.current.choice !== null &&
      previous.current.choice !== "standard" &&
      choice === "standard" &&
      levels !== undefined &&
      !levels.some((level) => level.id === previous.current.choice)
    )
      toast.info(
        "Speed was set to Standard because this model does not support the previous level.",
      );
    previous.current = { key, runtimeKind, choice };
  }, [choice, levels, key, runtimeKind]);
  return {
    choice,
    setChoice: (choice: string) => setDraft({ key, runtimeKind, choice }),
  };
}

export function useSpeedDraftControl(
  input: Omit<Parameters<typeof buildSpeedControl>[0], "choice" | "onChange"> & {
    initialChoice?: string | null;
  },
) {
  const draft = useSpeedDraft(
    input.key,
    input.runtimeKind,
    input.catalog,
    input.model,
    input.initialChoice,
  );
  return {
    choice: draft.choice,
    control: buildSpeedControl({ ...input, choice: draft.choice, onChange: draft.setChoice }),
  };
}
