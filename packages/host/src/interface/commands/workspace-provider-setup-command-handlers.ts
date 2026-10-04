import {
  workspaceProviderSetupBeginSchema,
  workspaceProviderSetupRefSchema,
  workspaceProviderSetupSetSchema,
  workspaceProviderSetupCommitSchema,
} from "@openducktor/contracts";
import { z } from "zod";
import { Effect } from "effect";
import type { WorkspaceProviderSetupService } from "../../application/workspaces/workspace-provider-setup-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { configValidationError } from "../../config/config-validation-message";
import type { HostCommandArgs } from "../router/host-command-router";
const parseConfig = <T>(schema: z.ZodType<T>, args: HostCommandArgs) =>
  Effect.try({
    try: () => schema.parse(args),
    catch: (cause) => configValidationError(cause),
  });
const idSchema = z.strictObject({ setupId: z.string().uuid() });
export const createWorkspaceProviderSetupCommandHandlers = (
  service: WorkspaceProviderSetupService,
) =>
  ({
    workspace_provider_setup_begin: (args) =>
      parseConfig(workspaceProviderSetupBeginSchema, args).pipe(
        Effect.flatMap(({ repoPath }) => service.begin(repoPath)),
      ),
    workspace_provider_setup_set: (args) =>
      parseConfig(workspaceProviderSetupSetSchema, args).pipe(
        Effect.flatMap(({ selection, ...ref }) => service.set(ref, selection)),
      ),
    workspace_provider_setup_detect: (args) =>
      parseConfig(workspaceProviderSetupRefSchema, args).pipe(Effect.flatMap(service.detect)),
    workspace_provider_setup_status: (args) =>
      parseConfig(workspaceProviderSetupRefSchema, args).pipe(Effect.flatMap(service.status)),
    workspace_provider_setup_github: (args) =>
      parseConfig(
        workspaceProviderSetupRefSchema.extend({
          host: z
            .string()
            .trim()
            .min(1)
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/),
        }),
        args,
      ).pipe(Effect.flatMap(({ host, ...ref }) => service.github(ref, host))),
    workspace_provider_setup_areas: (args) =>
      parseConfig(workspaceProviderSetupRefSchema, args).pipe(Effect.flatMap(service.areas)),
    workspace_provider_setup_sign_in: (args) =>
      parseConfig(workspaceProviderSetupRefSchema, args).pipe(Effect.flatMap(service.signIn)),
    workspace_provider_setup_cancel_sign_in: (args) =>
      parseConfig(
        workspaceProviderSetupRefSchema.extend({ attemptId: z.string().uuid() }),
        args,
      ).pipe(Effect.flatMap(({ attemptId, ...ref }) => service.cancelSignIn(ref, attemptId))),
    workspace_provider_setup_pat: (args) =>
      parseConfig(workspaceProviderSetupRefSchema.extend({ pat: z.string().min(1) }), args).pipe(
        Effect.flatMap(({ pat, ...ref }) => service.pat(ref, pat)),
      ),
    workspace_provider_setup_disconnect: (args) =>
      parseConfig(workspaceProviderSetupRefSchema, args).pipe(Effect.flatMap(service.disconnect)),
    workspace_provider_setup_commit: (args) =>
      parseConfig(workspaceProviderSetupCommitSchema, args).pipe(Effect.flatMap(service.commit)),
    workspace_provider_setup_progress: (args) =>
      parseConfig(idSchema, args).pipe(Effect.flatMap(({ setupId }) => service.progress(setupId))),
    workspace_provider_setup_discard: (args) =>
      parseConfig(idSchema, args).pipe(Effect.flatMap(({ setupId }) => service.discard(setupId))),
  }) satisfies HostCommandHandlerDefinitions;
