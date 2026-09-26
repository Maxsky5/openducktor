import type { GitPort } from "../../ports/git-port";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createModelCatalogPreviewService } from "../../application/runtimes/model-catalog-preview-service";
import { createNodeModelCatalogPreview } from "../../adapters/runtimes/process-model-catalog-preview";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";

export const createModelCatalogPreviewComposition = (
  { settingsConfig, toolDiscovery, processEnvironment }: NodeHostDefaultPorts,
  gitPort: GitPort,
  runtimeDefinitionsService: RuntimeDefinitionsService,
  clientVersion?: string,
) =>
  createModelCatalogPreviewService({
    gitPort,
    runtimeDefinitionsService,
    readModels: createNodeModelCatalogPreview({
      settingsConfig,
      toolDiscovery,
      processEnv: processEnvironment.environment,
      processPathError: processEnvironment.error?.message ?? null,
      clientVersion: clientVersion ?? processEnvironment.environment.npm_package_version ?? "0.0.0",
    }),
  });
