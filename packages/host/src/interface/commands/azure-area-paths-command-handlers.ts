import { azureAreaPathsInputSchema } from "@openducktor/contracts";
import type { createAzureAreaPathsService } from "../../application/git/azure-area-paths-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";

export const createAzureAreaPathsCommandHandlers = (
  service: ReturnType<typeof createAzureAreaPathsService>,
) =>
  ({
    azure_area_paths_list: (args) => {
      const parsed = azureAreaPathsInputSchema.safeParse(args);
      if (!parsed.success)
        throw new HostValidationError({
          field: "azure_area_paths_list",
          message: "Area path input is invalid. Check the repository and retry.",
        });
      return service.list(parsed.data.repoPath);
    },
  }) satisfies HostCommandHandlerDefinitions;
