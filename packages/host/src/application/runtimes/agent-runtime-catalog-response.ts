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

export const toCatalogResponse = (
  read: AgentRuntimeCatalogRead,
  runtime: RuntimeInstanceSummary,
): AgentRuntimeCatalog => {
  const label = runtime.descriptor.label;
  const response: AgentRuntimeCatalog = {};
  if (read.runtime !== undefined) {
    response.runtime = read.runtime;
  }
  if (read.models !== undefined) {
    response.models = toSurfaceResponse(
      label,
      "model catalog",
      read.models,
      agentModelCatalogSchema,
    );
  }
  if (read.slashCommands !== undefined) {
    response.slashCommands = toSurfaceResponse(
      label,
      "slash command catalog",
      read.slashCommands,
      slashCommandCatalogSchema,
    );
  }
  if (read.skills !== undefined) {
    response.skills = toSurfaceResponse(label, "skill catalog", read.skills, skillCatalogSchema);
  }
  if (read.subagents !== undefined) {
    response.subagents = toSurfaceResponse(
      label,
      "subagent catalog",
      read.subagents,
      subagentCatalogSchema,
    );
  }
  return response;
};

const toSurfaceResponse = <Catalog>(
  label: string,
  surfaceName: string,
  read: AgentRuntimeCatalogSurfaceRead<Catalog>,
  schema: z.ZodType<Catalog>,
): AgentRuntimeCatalogSurface<Catalog> => {
  if (read.status === "failed") {
    return {
      status: "failed",
      message: `${label} could not load ${surfaceName}. ${errorMessage(read.cause)} Retry this surface.`,
    };
  }
  const parsed = schema.safeParse(read.catalog);
  if (!parsed.success) {
    return {
      status: "failed",
      message: `${label} returned invalid ${surfaceName} data. ${formatIssues(parsed.error)} Update the runtime and retry this surface.`,
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
