import type { GitPort } from "../../ports/git-port";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createModelCatalogPreviewService } from "../../application/runtimes/model-catalog-preview-service";
import { createNodeModelCatalogPreview } from "../../adapters/runtimes/process-model-catalog-preview";
import type { NodeHostDefaultPorts } from "./node-host-default-ports";
import { guardModelCatalogPreview } from "./user-path-guards";

export const createModelCatalogPreviewComposition = (
  { settingsConfig, toolDiscovery, userEnvironment, readEnv, startupEnv }: NodeHostDefaultPorts,
  gitPort: GitPort,
  runtimeDefinitionsService: RuntimeDefinitionsService,
  clientVersion?: string,
) =>
  createModelCatalogPreviewService({
    gitPort,
    runtimeDefinitionsService,
    readModels: guardModelCatalogPreview(
      createNodeModelCatalogPreview({
        settingsConfig,
        toolDiscovery,
        readEnv,
        clientVersion: clientVersion ?? startupEnv.npm_package_version ?? "0.0.0",
      }),
      userEnvironment,
    ),
  });
