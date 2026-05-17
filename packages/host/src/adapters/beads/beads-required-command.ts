import { Effect } from "effect";
import { HostDependencyError } from "../../effect/host-errors";
import type { SystemCommandPort } from "../../ports/system-command-port";

export const assertRequiredCommand = (
  systemCommands: Pick<SystemCommandPort, "requiredCommandError"> | undefined,
  command: string,
) => {
  if (!systemCommands) {
    return Effect.succeed(undefined);
  }
  return Effect.gen(function* () {
    const error = yield* systemCommands.requiredCommandError(command);
    if (error !== null) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: command,
          operation: "beadsTaskRepository.assertRequiredCommand",
          message: error,
        }),
      );
    }
  });
};
