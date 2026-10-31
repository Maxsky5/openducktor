import {
  workspaceSessionArchiveInputSchema,
  workspaceSessionCreateInputSchema,
  workspaceSessionForkInputSchema,
  workspaceSessionListInputSchema,
  workspaceSessionRefInputSchema,
  workspaceSessionStartInputSchema,
  workspaceSessionRenameInputSchema,
  workspaceSessionSetDraftModelInputSchema,
  workspaceSessionSetTargetBranchInputSchema,
} from "@openducktor/contracts";
import { Effect, Exit } from "effect";
import type { z } from "zod";
import type { WorkspaceSessionService } from "../../application/workspaces/workspace-session-service";
import type { WorkspaceSessionUpdatedPublisher } from "../../application/workspaces/workspace-session-persistence-callbacks";
import { causeMessage, HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";
import { startupStep } from "../../application/agent-sessions/session-startup-progress";

export const createWorkspaceSessionCommandHandlers = (
  service: WorkspaceSessionService,
  publishUpdated: WorkspaceSessionUpdatedPublisher,
) =>
  ({
    workspace_session_ids_list: (args) =>
      parseInput(workspaceSessionListInputSchema, args).pipe(
        Effect.flatMap(({ workspaceId }) => service.listIds(workspaceId)),
      ),
    workspace_session_list_active: (args) =>
      parseInput(workspaceSessionListInputSchema, args).pipe(
        Effect.flatMap(({ workspaceId }) => service.listActive(workspaceId)),
      ),
    workspace_session_list_archived: (args) =>
      parseInput(workspaceSessionListInputSchema, args).pipe(
        Effect.flatMap(({ workspaceId }) => service.listArchived(workspaceId)),
      ),
    workspace_session_get: (args) =>
      parseInput(workspaceSessionRefInputSchema, args).pipe(Effect.flatMap(service.get)),
    workspace_session_archive_preview: (args) =>
      parseInput(workspaceSessionRefInputSchema, args).pipe(Effect.flatMap(service.archivePreview)),
    workspace_session_worktrees_list: (args) =>
      parseInput(workspaceSessionListInputSchema, args).pipe(
        Effect.flatMap(({ workspaceId }) => service.listWorktrees(workspaceId)),
      ),
    workspace_session_create: (args) =>
      parseInput(workspaceSessionCreateInputSchema, args).pipe(
        Effect.flatMap((input) =>
          service
            .create(input)
            .pipe(
              Effect.tap(({ session }) =>
                startupStep(
                  { id: "publish", label: "Publish saved session" },
                  publishUpdated(input.workspaceId, session),
                ),
              ),
            ),
        ),
      ),
    workspace_session_fork: (args) =>
      parseInput(workspaceSessionForkInputSchema, args).pipe(
        Effect.flatMap((input) =>
          Effect.gen(function* () {
            const result = yield* service.fork(input);
            const published = yield* Effect.exit(
              startupStep(
                { id: "publish", label: "Publish saved session" },
                Effect.suspend(() => publishUpdated(input.workspaceId, result.record)),
              ),
            );
            if (Exit.isFailure(published))
              result.syncWarning = `The fork was saved, but session updates could not sync: ${causeMessage(published.cause)}. Reconnect to refresh sessions.`;
            return result;
          }),
        ),
      ),
    workspace_session_start: (args) =>
      parseInput(workspaceSessionStartInputSchema, args).pipe(
        Effect.flatMap((input) =>
          service
            .start(input)
            .pipe(
              Effect.tap(({ session }) =>
                startupStep(
                  { id: "publish", label: "Publish saved session" },
                  publishUpdated(input.workspaceId, session),
                ),
              ),
            ),
        ),
      ),
    workspace_session_set_draft_model: (args) =>
      parseInput(workspaceSessionSetDraftModelInputSchema, args).pipe(
        Effect.flatMap((input) =>
          service
            .setDraftModel(input)
            .pipe(Effect.tap((session) => publishUpdated(input.workspaceId, session))),
        ),
      ),
    workspace_session_set_target_branch: (args) =>
      parseInput(workspaceSessionSetTargetBranchInputSchema, args).pipe(
        Effect.flatMap((input) =>
          service
            .setTargetBranch(input)
            .pipe(Effect.tap((session) => publishUpdated(input.workspaceId, session))),
        ),
      ),
    workspace_session_rename: (args) =>
      parseInput(workspaceSessionRenameInputSchema, args).pipe(
        Effect.flatMap((input) =>
          service
            .rename(input)
            .pipe(Effect.tap((session) => publishUpdated(input.workspaceId, session))),
        ),
      ),
    workspace_session_archive: (args) =>
      parseInput(workspaceSessionArchiveInputSchema, args).pipe(
        Effect.flatMap((input) =>
          service
            .archive(input)
            .pipe(Effect.tap((session) => publishUpdated(input.workspaceId, session))),
        ),
      ),
    workspace_session_restore: (args) =>
      parseInput(workspaceSessionRefInputSchema, args).pipe(
        Effect.flatMap((input) =>
          service
            .restore(input)
            .pipe(Effect.tap((session) => publishUpdated(input.workspaceId, session))),
        ),
      ),
  }) satisfies HostCommandHandlerDefinitions;

const parseInput = <A>(schema: z.ZodType<A>, args: HostCommandArgs) =>
  Effect.try({
    try: () => schema.parse(args),
    catch: (cause) =>
      new HostValidationError({
        message:
          cause instanceof Error ? cause.message : "Invalid Workspace Session command input.",
        field: "args",
        cause,
      }),
  });
