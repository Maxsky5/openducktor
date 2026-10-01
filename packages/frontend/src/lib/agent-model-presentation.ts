import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { findCatalogModel } from "./model-catalog-selection";

/** Model metadata shared by final chat messages and session previews. */
export const agentModelInfoParts = (
  model: Partial<Pick<AgentModelSelection, "profileId" | "providerId" | "modelId" | "variant">>,
  catalog?: AgentModelCatalog | null,
): string[] => {
  const parts: string[] = [];
  const profile = model.profileId?.trim();
  if (profile) parts.push(profile);
  const providerId = model.providerId?.trim();
  const modelId = model.modelId?.trim();
  const catalogModel =
    catalog && providerId && modelId ? findCatalogModel(catalog, { providerId, modelId }) : null;
  const providerModel = [providerId, catalogModel?.modelName?.trim() ?? modelId]
    .filter(Boolean)
    .join("/");
  if (providerModel) parts.push(providerModel);
  const effort = model.variant?.trim();
  if (effort) parts.push(effort);
  return parts;
};
