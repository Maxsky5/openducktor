import {
  taskAssetDiscardStagedInputSchema,
  taskAssetStageInputSchema,
} from "@openducktor/contracts";
import type { TaskAssetStagingService } from "../../application/task-assets/task-asset-staging-service";
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import { defineHostCommandHandlers } from "../router/host-command-router";

const parseInput = <T>(schema: z.ZodType<T>, value: unknown, command: string): T => {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new HostValidationError({
    field: command,
    message: `${command} input is invalid: ${parsed.error.message}`,
  });
};

export const createTaskAssetCommandHandlers = (stagingService: TaskAssetStagingService) =>
  defineHostCommandHandlers({
    task_asset_discard_staged: (args) =>
      stagingService.discard(
        parseInput(taskAssetDiscardStagedInputSchema, args, "task_asset_discard_staged"),
      ),
    task_asset_stage: (args) =>
      stagingService.stage(parseInput(taskAssetStageInputSchema, args, "task_asset_stage")),
  });
