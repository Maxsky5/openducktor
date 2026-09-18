import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import {
  agentModelCatalogSchema,
  skillCatalogSchema,
  slashCommandCatalogSchema,
  subagentCatalogSchema,
  type AgentRuntimeCatalog,
  type AgentRuntimeCatalogSurface,
} from "@openducktor/contracts";
import type { AgentRuntimeCatalogRead, AgentRuntimeCatalogSurfaceRead } from "@openducktor/core";
import { errorMessage } from "../../effect/host-errors";

export const toAgentRuntimeCatalogResponse = (
  read: AgentRuntimeCatalogRead,
  runtime: RuntimeInstanceSummary,
): AgentRuntimeCatalog => {
  const label = runtime.descriptor.label;
  const response: AgentRuntimeCatalog = {};
  if (read.runtime !== undefined) {
    response.runtime = read.runtime;
  }
  if (read.models !== undefined) {
    response.models = toSurface(label, "model catalog", read.models, (catalog) =>
      agentModelCatalogSchema.safeParse(catalog),
    );
  }
  if (read.slashCommands !== undefined) {
    response.slashCommands = toSurface(
      label,
      "slash command catalog",
      read.slashCommands,
      (catalog) => slashCommandCatalogSchema.safeParse(catalog),
    );
  }
  if (read.skills !== undefined) {
    response.skills = toSurface(label, "skill catalog", read.skills, (catalog) =>
      skillCatalogSchema.safeParse(catalog),
    );
  }
  if (read.subagents !== undefined) {
    response.subagents = toSurface(label, "subagent catalog", read.subagents, (catalog) =>
      subagentCatalogSchema.safeParse(catalog),
    );
  }
  return response;
};

const toSurface = <Catalog>(
  label: string,
  surface: string,
  read: AgentRuntimeCatalogSurfaceRead<Catalog>,
  parse: (catalog: Catalog) => { success: boolean; error?: unknown },
): AgentRuntimeCatalogSurface<Catalog> => {
  if (read.status === "failed") {
    return {
      status: "failed",
      message: `${label} could not load ${surface}. ${errorMessage(read.cause)} Retry this surface.`,
    };
  }
  const parsed = parse(read.catalog);
  if (!parsed.success) {
    return {
      status: "failed",
      message: `${label} returned invalid ${surface} data. ${errorMessage(parsed.error)} Update the runtime and retry this surface.`,
    };
  }
  return { status: "available", catalog: read.catalog };
};
