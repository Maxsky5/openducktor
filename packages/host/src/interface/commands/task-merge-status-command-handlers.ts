import { taskMergeStatusRequestSchema } from "@openducktor/contracts";
import type { TaskMergeDetectionService } from "../../application/tasks/merge-detection/task-merge-detection-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { parseCommandInput } from "./command-inputs";

export const createTaskMergeStatusCommandHandlers = (
  mergeDetection: Pick<TaskMergeDetectionService, "getSnapshot" | "checkWorkspace">,
) =>
  ({
    task_merge_status_get: (args) =>
      mergeDetection.getSnapshot(
        parseCommandInput(taskMergeStatusRequestSchema, args, "task_merge_status_get").repoPath,
      ),
    task_merge_status_check: (args) =>
      mergeDetection.checkWorkspace(
        parseCommandInput(taskMergeStatusRequestSchema, args, "task_merge_status_check").repoPath,
      ),
  }) satisfies HostCommandHandlerDefinitions;
