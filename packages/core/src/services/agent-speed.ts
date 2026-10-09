import type {
  AgentModelCatalog,
  AgentSessionModelSettings,
  AgentSessionSpeedState,
  AgentSpeedLevel,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { findCatalogModel } from "./agent-runtime-catalog";

/** Missing metadata must not clear a saved speed choice. */
export const modelSpeedLevels = (
  runtime: RuntimeDescriptor,
  catalog: AgentModelCatalog | null | undefined,
  model: AgentSessionModelSettings | null | undefined,
): AgentSpeedLevel[] | undefined => {
  const support = runtime.capabilities.speed.support;
  if (support === "none") return [];
  if (support === "runtime") return runtime.capabilities.speed.levels;
  if (!catalog || !model) return undefined;
  return findCatalogModel(catalog, model)?.speedLevels;
};

export const speedEligibility = (
  runtime: RuntimeDescriptor,
  catalog: AgentModelCatalog | null | undefined,
  model: AgentSessionModelSettings | null | undefined,
  choice?: string,
): "supported" | "unsupported" | "unknown" => {
  const levels = modelSpeedLevels(runtime, catalog, model);
  if (levels === undefined) return "unknown";
  return (choice ? levels.some((level) => level.id === choice) : levels.length > 1)
    ? "supported"
    : "unsupported";
};

export const initialSpeedState = (
  choice: string | null,
  synchronization: AgentSessionSpeedState["synchronization"] = "unapplied",
): AgentSessionSpeedState => ({
  choice,
  synchronization,
  availability: { status: "unknown" },
  processing: { status: choice === "standard" ? "off" : "unknown" },
});
