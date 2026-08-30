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
import type { HostCommandArgs } from "../commands/command-inputs";
import { type HostCommandName, parseHostCommandName } from "../commands/host-command-registry";
import type { HostCommandResultMap } from "./host-command-contract-map";

export type HostCommandResult<Command extends HostCommandName = HostCommandName> =
  HostCommandResultMap[Command];
export type { HostCommandArgs } from "../commands/command-inputs";
export type HostCommandHandlerError =
  | CodexSessionHistoryError
  | DevServerProcessStartExitError
  | FilesystemListDirectoryError
  | HostError
  | TaskAssetError
  | TaskPolicyError
  | TerminalServiceError
  | WorkspaceTextFileWriteError;

export type HostCommandHandlerDefinitions = Partial<
  Record<HostCommandName, (args: HostCommandArgs) => void>
>;
export type HostCommandHandler<Command extends HostCommandName> = (
  args: HostCommandArgs,
) => Effect.Effect<HostCommandResult<Command>, HostCommandHandlerError>;
export type HostCommandHandlers = {
  [Command in HostCommandName]?: HostCommandHandler<Command>;
};

export type EffectHostCommandRouter = {
  dispose(): Effect.Effect<void, HostCommandHandlerError>;
  initialize(): Effect.Effect<void, HostCommandHandlerError>;
  invoke<Command extends HostCommandName>(
    command: Command,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Effect.Effect<HostCommandResult<Command>, HostCommandHandlerError>;
  invoke(
    command: string,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Effect.Effect<HostCommandResult, HostCommandHandlerError>;
};
export type HostCommandRouter = {
  dispose(): Promise<void>;
  initialize(): Promise<void>;
  invoke<Command extends HostCommandName>(
    command: Command,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Promise<HostCommandResult<Command>>;
  invoke(command: string, args?: Exclude<HostCommandArgs, undefined>): Promise<HostCommandResult>;
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
}: CreateHostCommandRouterInput): EffectHostCommandRouter => {
  function invoke<Command extends HostCommandName>(
    command: Command,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Effect.Effect<HostCommandResult<Command>, HostCommandHandlerError>;
  function invoke(
    command: string,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Effect.Effect<HostCommandResult, HostCommandHandlerError>;
  function invoke(
    command: string,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Effect.Effect<HostCommandResult, HostCommandHandlerError> {
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
        try: () => handler(args),
        catch: (cause) => toHostCommandHandlerError(cause, hostCommand),
      });
      return yield* handlerEffect;
    });
  }

  return {
    dispose() {
      return dispose ? dispose() : Effect.void;
    },
    initialize() {
      return initialize ? initialize() : Effect.void;
    },
    invoke,
  };
};

export const toPromiseHostCommandRouter = (router: EffectHostCommandRouter): HostCommandRouter => {
  function invoke<Command extends HostCommandName>(
    command: Command,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Promise<HostCommandResult<Command>>;
  function invoke(
    command: string,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Promise<HostCommandResult>;
  function invoke(
    command: string,
    args?: Exclude<HostCommandArgs, undefined>,
  ): Promise<HostCommandResult> {
    return runBoundary(router.invoke(command, args));
  }

  return {
    async dispose() {
      await runBoundary(router.dispose());
    },
    async initialize() {
      await runBoundary(router.initialize());
    },
    invoke,
  };
};
