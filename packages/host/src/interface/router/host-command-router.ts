import { Effect, Exit } from "effect";
import type { FilesystemListDirectoryError } from "../../application/filesystem/filesystem-service";
import { WorkspaceTextFileWriteError } from "../../application/filesystem/workspace-text-file-service";
import type { TerminalServiceError } from "../../application/terminals/terminal-service-error";
import type { TaskPolicyError } from "../../domain/task/task-policy-error";
import type { HostError } from "../../effect/host-errors";
import {
  causeToHostBoundaryError,
  HostOperationError,
  HostResourceError,
  isHostError,
} from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { CodexSessionHistoryError } from "../../ports/codex-session-history-error";
import type { DevServerProcessStartExitError } from "../../ports/dev-server-process-port";
import { type HostCommandName, parseHostCommandName } from "../commands/host-command-registry";
import { jsonValueSchema, type JsonValue } from "@openducktor/contracts";

export type HostCommandResult = JsonValue;
export type UnvalidatedHostCommandResult = object | string | number | boolean | null | void;
export type HostCommandArgs = Record<string, unknown> | undefined;
export type HostCommandContext = {
  command: HostCommandName;
  args: HostCommandArgs;
};
export type HostCommandHandlerError =
  | CodexSessionHistoryError
  | DevServerProcessStartExitError
  | FilesystemListDirectoryError
  | HostError
  | TaskAssetError
  | TaskPolicyError
  | TerminalServiceError
  | WorkspaceTextFileWriteError;

export type HostCommandHandler = (
  args: HostCommandArgs,
  context: HostCommandContext,
) => Effect.Effect<UnvalidatedHostCommandResult, HostCommandHandlerError>;
export type HostCommandHandlers = Partial<Record<HostCommandName, HostCommandHandler>>;
export type EffectHostCommandRouter = {
  dispose(): Effect.Effect<void, HostCommandHandlerError>;
  initialize(): Effect.Effect<void, HostCommandHandlerError>;
  invoke(
    command: string,
    args?: Record<string, unknown>,
  ): Effect.Effect<HostCommandResult, HostCommandHandlerError>;
};
export type HostCommandRouter = {
  dispose(): Promise<void>;
  initialize(): Promise<void>;
  invoke(command: string, args?: Record<string, unknown>): Promise<HostCommandResult>;
};
export type CreateHostCommandRouterInput = {
  dispose?: () => Effect.Effect<void, HostCommandHandlerError>;
  initialize?: () => Effect.Effect<void, HostCommandHandlerError>;
  handlers: HostCommandHandlers;
};
const toHostCommandHandlerError = (
  cause: unknown,
  command: HostCommandName,
): HostCommandHandlerError => {
  if (isHostError(cause)) {
    return cause;
  }
  if (cause instanceof TaskAssetError) {
    return cause;
  }
  if (cause instanceof WorkspaceTextFileWriteError) {
    return cause;
  }
  return new HostOperationError({
    operation: "host-command-router.invoke",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
    details: { command },
  });
};

const runBoundary = async <A>(effect: Effect.Effect<A, HostCommandHandlerError>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw causeToHostBoundaryError(exit.cause);
};

export const createEffectHostCommandRouter = ({
  dispose,
  initialize,
  handlers,
}: CreateHostCommandRouterInput): EffectHostCommandRouter => ({
  dispose() {
    return dispose ? dispose() : Effect.void;
  },
  initialize() {
    return initialize ? initialize() : Effect.void;
  },
  invoke(command, args) {
    return Effect.gen(function* () {
      const hostCommand = yield* Effect.try({
        try: () => parseHostCommandName(command),
        catch: (cause) =>
          isHostError(cause)
            ? cause
            : new HostResourceError({
                message: cause instanceof Error ? cause.message : String(cause),
                resource: "host-command-name",
                operation: "host-command-router.parse",
                cause,
                details: { command },
              }),
      });
      const handler = handlers[hostCommand];
      if (!handler) {
        return yield* Effect.fail(
          new HostResourceError({
            message: `OpenDucktor TypeScript host command is not registered: ${hostCommand}`,
            resource: "host-command-handler",
            operation: "host-command-router.invoke",
            details: { command: hostCommand },
          }),
        );
      }
      const handlerEffect = yield* Effect.try({
        try: () => handler(args, { command: hostCommand, args }),
        catch: (cause) => toHostCommandHandlerError(cause, hostCommand),
      });
      const result = yield* handlerEffect;
      return yield* Effect.try({
        try: () => jsonValueSchema.parse(result === undefined ? null : result),
        catch: (cause) => toHostCommandHandlerError(cause, hostCommand),
      });
    });
  },
});

export const toPromiseHostCommandRouter = (router: EffectHostCommandRouter): HostCommandRouter => ({
  async dispose() {
    await runBoundary(router.dispose());
  },
  async initialize() {
    await runBoundary(router.initialize());
  },
  async invoke(command, args) {
    return runBoundary(router.invoke(command, args));
  },
});
