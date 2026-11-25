import { workflowLibraryInputSchemas } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  WorkflowLibraryCommandInputs,
  WorkflowLibraryService,
} from "../../application/workflow-library/workflow-library-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";

type LibraryCommand = keyof typeof workflowLibraryInputSchemas;

const parseInput = <Command extends LibraryCommand>(command: Command, args: HostCommandArgs) =>
  Effect.try({
    try: () =>
      // SAFETY: the schema of each command parses to the input of that command. TypeScript loses
      // the link through the indexed access of a generic key.
      workflowLibraryInputSchemas[command].parse(args) as WorkflowLibraryCommandInputs[Command],
    catch: (cause) =>
      new HostValidationError({
        message: `${command} input is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
        field: "args",
        cause,
        details: { command },
      }),
  });

export const createWorkflowLibraryCommandHandlers = (service: WorkflowLibraryService) =>
  ({
    workflow_library_list: (args) =>
      parseInput("workflow_library_list", args).pipe(Effect.flatMap(() => service.library())),
    workflow_document_get: (args) =>
      parseInput("workflow_document_get", args).pipe(Effect.flatMap(service.document)),
    workflow_versions_list: (args) =>
      parseInput("workflow_versions_list", args).pipe(Effect.flatMap(service.versions)),
    workflow_task_use_get: (args) =>
      parseInput("workflow_task_use_get", args).pipe(Effect.flatMap(service.taskUse)),
    workflow_task_moves_get: (args) =>
      parseInput("workflow_task_moves_get", args).pipe(Effect.flatMap(service.taskMoves)),
    workflow_role_impact_get: (args) =>
      parseInput("workflow_role_impact_get", args).pipe(Effect.flatMap(service.roleImpact)),
    workflow_export: (args) =>
      parseInput("workflow_export", args).pipe(Effect.flatMap(service.exportWorkflow)),
    workflow_import_preview: (args) =>
      parseInput("workflow_import_preview", args).pipe(Effect.flatMap(service.importPreview)),
    workflow_create: (args) =>
      parseInput("workflow_create", args).pipe(Effect.flatMap(service.create)),
    workflow_draft_save: (args) =>
      parseInput("workflow_draft_save", args).pipe(Effect.flatMap(service.saveDraft)),
    workflow_draft_discard: (args) =>
      parseInput("workflow_draft_discard", args).pipe(Effect.flatMap(service.discardDraft)),
    workflow_publish: (args) =>
      parseInput("workflow_publish", args).pipe(Effect.flatMap(service.publish)),
    workflow_tasks_move: (args) =>
      parseInput("workflow_tasks_move", args).pipe(Effect.flatMap(service.moveTasks)),
    workflow_delete: (args) =>
      parseInput("workflow_delete", args).pipe(Effect.flatMap(service.deleteWorkflow)),
    workflow_import_commit: (args) =>
      parseInput("workflow_import_commit", args).pipe(Effect.flatMap(service.importCommit)),
    workflow_role_save: (args) =>
      parseInput("workflow_role_save", args).pipe(Effect.flatMap(service.saveRole)),
    workflow_role_delete: (args) =>
      parseInput("workflow_role_delete", args).pipe(Effect.flatMap(service.deleteRole)),
    workflow_availability_set: (args) =>
      parseInput("workflow_availability_set", args).pipe(Effect.flatMap(service.setAvailability)),
    workflow_default_set: (args) =>
      parseInput("workflow_default_set", args).pipe(Effect.flatMap(service.setDefault)),
  }) satisfies HostCommandHandlerDefinitions;
