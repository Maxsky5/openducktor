import { Effect, Exit } from "effect";
import type { FilesystemListDirectoryError } from "../../application/filesystem/filesystem-service";
import type { TaskPolicyError } from "../../domain/task/task-policy-error";
import type {
  HostCommandError,
  HostDependencyError,
  HostInvariantError,
  HostOperationError,
  HostValidationError,
} from "../../effect/host-errors";
import { causeToHostBoundaryError, HostResourceError } from "../../effect/host-errors";
import type { DevServerProcessStartExitError } from "../../ports/dev-server-process-port";
import { type HostCommandName, parseHostCommandName } from "../commands/host-command-registry";
export type HostCommandArgs = Record<string, unknown> | undefined;
export type HostCommandContext = {
  command: HostCommandName;
  args: HostCommandArgs;
};
export type HostCommandHandlerError =
  | DevServerProcessStartExitError
  | FilesystemListDirectoryError
  | HostCommandError
  | HostDependencyError
  | HostInvariantError
  | HostOperationError
  | HostResourceError
  | HostValidationError
  | TaskPolicyError;

export type HostCommandHandler = (
  args: HostCommandArgs,
  context: HostCommandContext,
) => Effect.Effect<unknown, HostCommandHandlerError> | Promise<unknown> | unknown;
export type HostCommandHandlers = Partial<Record<HostCommandName, HostCommandHandler>>;
export type HostCommandRouter = {
  dispose(): Promise<void>;
  initialize(): Promise<void>;
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
};
export type CreateHostCommandRouterInput = {
  dispose?: () => Promise<void> | void;
  initialize?: () => Promise<void> | void;
  handlers: HostCommandHandlers;
};
export const createHostCommandRouter = ({
  dispose,
  initialize,
  handlers,
}: CreateHostCommandRouterInput): HostCommandRouter => ({
  async dispose() {
    await dispose?.();
  },
  async initialize() {
    await initialize?.();
  },
  async invoke(command, args) {
    const hostCommand = parseHostCommandName(command);
    const handler = handlers[hostCommand];
    if (!handler) {
      throw new HostResourceError({
        message: `OpenDucktor TypeScript host command is not registered: ${hostCommand}`,
        resource: "host-command-handler",
        operation: "host-command-router.invoke",
        details: { command: hostCommand },
      });
    }
    const result = handler(args, { command: hostCommand, args });
    if (Effect.isEffect(result)) {
      const exit = await Effect.runPromiseExit(
        result as Effect.Effect<unknown, HostCommandHandlerError>,
      );
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      throw causeToHostBoundaryError(exit.cause);
    }
    return result;
  },
});
