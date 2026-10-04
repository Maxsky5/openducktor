import {
  taskAssetDiscardStagedInputSchema,
  taskAssetStageInputSchema,
} from "@openducktor/contracts";
import type { TaskAssetStagingService } from "../../application/task-assets/task-asset-staging-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { parseCommandInput } from "./command-inputs";

export const createTaskAssetCommandHandlers = (stagingService: TaskAssetStagingService) =>
  ({
    task_asset_discard_staged: (args) =>
      stagingService.discard(
        parseCommandInput(taskAssetDiscardStagedInputSchema, args, "task_asset_discard_staged"),
      ),
    task_asset_stage: (args) =>
      stagingService.stage(parseCommandInput(taskAssetStageInputSchema, args, "task_asset_stage")),
  }) satisfies HostCommandHandlerDefinitions;
