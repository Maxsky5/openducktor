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
import { z } from "zod";
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
    response.models = toSurface(label, "model catalog", read.models, agentModelCatalogSchema);
  }
  if (read.slashCommands !== undefined) {
    response.slashCommands = toSurface(
      label,
      "slash command catalog",
      read.slashCommands,
      slashCommandCatalogSchema,
    );
  }
  if (read.skills !== undefined) {
    response.skills = toSurface(label, "skill catalog", read.skills, skillCatalogSchema);
  }
  if (read.subagents !== undefined) {
    response.subagents = toSurface(
      label,
      "subagent catalog",
      read.subagents,
      subagentCatalogSchema,
    );
  }
  return response;
};

const toSurface = <Catalog>(
  label: string,
  surface: string,
  read: AgentRuntimeCatalogSurfaceRead<Catalog>,
  schema: z.ZodType<Catalog>,
): AgentRuntimeCatalogSurface<Catalog> => {
  if (read.status === "failed") {
    return {
      status: "failed",
      message: `${label} could not load ${surface}. ${errorMessage(read.cause)} Retry this surface.`,
    };
  }
  const parsed = schema.safeParse(read.catalog);
  if (!parsed.success) {
    return {
      status: "failed",
      message: `${label} returned invalid ${surface} data. ${formatIssues(parsed.error)} Update the runtime and retry this surface.`,
    };
  }
  return { status: "available", catalog: read.catalog };
};

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
    )
    .join("; ");
