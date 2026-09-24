import {
  workspaceSessionExternalListInputSchema,
  workspaceSessionExternalReleaseInputSchema,
  workspaceSessionImportInputSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import type { createWorkspaceSessionImportService } from "../../application/workspaces/workspace-session-import-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";
const parse = <A>(schema: z.ZodType<A>, args: HostCommandArgs) =>
  Effect.try({
    try: () => schema.parse(args),
    catch: (cause) =>
      new HostValidationError({ field: "args", message: "Invalid session import request.", cause }),
  });
export const createWorkspaceSessionImportCommandHandlers = (
  service: ReturnType<typeof createWorkspaceSessionImportService>,
) =>
  ({
    workspace_session_external_list: (args) =>
      parse(workspaceSessionExternalListInputSchema, args).pipe(Effect.flatMap(service.list)),
    workspace_session_external_release: (args) =>
      parse(workspaceSessionExternalReleaseInputSchema, args).pipe(
        Effect.flatMap(service.release),
        Effect.as(true),
      ),
    workspace_session_import: (args) =>
      parse(workspaceSessionImportInputSchema, args).pipe(Effect.flatMap(service.importSession)),
  }) satisfies HostCommandHandlerDefinitions;
