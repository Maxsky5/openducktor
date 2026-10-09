import type { TerminalLaunchSpec } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostPathNotFoundError } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { TerminalGrid, TerminalPtyLaunchPlan } from "../../ports/terminal-pty-port";
import type { TerminalCommandLines } from "./terminal-command";
import { TerminalServiceError } from "./terminal-service-error";

type TerminalLaunchPolicyInput = {
  filesystem: FilesystemPort;
  environment: TerminalLaunchEnvironmentPort;
};

export type TerminalShellLaunch = Pick<TerminalPtyLaunchPlan, "shell" | "args" | "env">;
export type TerminalCommandLaunch = Pick<
  TerminalPtyLaunchPlan,
  "shell" | "args" | "env" | "windowsBatchScript"
>;

/** Selects how the account shell runs. Only infrastructure knows the shell and its syntax. */
export type TerminalLaunchEnvironmentPort = {
  /** Returns how to start the interactive login shell. */
  shell(): Effect.Effect<TerminalShellLaunch, TerminalServiceError>;
  /**
   * Returns how to run the command lines in order in one login shell process, and how to start the
   * shell after them. The process stops after the first failed line and exits with the status of
   * the last line that ran. Fails with `unsupported_shell` when the login shell has no supported
   * command syntax.
   */
  command(
    commandLines: TerminalCommandLines,
  ): Effect.Effect<
    { shell: TerminalShellLaunch; command: TerminalCommandLaunch },
    TerminalServiceError
  >;
};

export type TerminalCommandLaunchPlans = {
  command: TerminalPtyLaunchPlan;
  /** The shell that continues after the command. */
  shell: TerminalPtyLaunchPlan;
};

export const createTerminalLaunchPolicy = ({
  filesystem,
  environment,
}: TerminalLaunchPolicyInput) => {
  const resolveWorkingDir = (
    spec: TerminalLaunchSpec,
  ): Effect.Effect<string, TerminalServiceError> =>
    Effect.gen(function* () {
      const canonicalWorkingDir = yield* filesystem.canonicalize(spec.workingDir).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code: "working_directory_inaccessible",
              operation: "create",
              message: `Cannot resolve terminal working directory: ${spec.workingDir}`,
              workingDir: spec.workingDir,
              cause,
            }),
        ),
      );
      const stats = yield* filesystem.stat(canonicalWorkingDir).pipe(
        Effect.mapError(
          (cause) =>
            new TerminalServiceError({
              code:
                cause.cause instanceof HostPathNotFoundError
                  ? "working_directory_not_found"
                  : "working_directory_inaccessible",
              operation: "create",
              message: `Cannot access terminal working directory: ${canonicalWorkingDir}`,
              workingDir: canonicalWorkingDir,
              cause,
            }),
        ),
      );
      if (!stats.isDirectory) {
        return yield* new TerminalServiceError({
          code: "working_directory_not_directory",
          operation: "create",
          message: `Terminal working directory is not a directory: ${canonicalWorkingDir}`,
          workingDir: canonicalWorkingDir,
        });
      }
      return canonicalWorkingDir;
    });

  return {
    shell: (
      spec: TerminalLaunchSpec,
      grid: TerminalGrid,
    ): Effect.Effect<TerminalPtyLaunchPlan, TerminalServiceError> =>
      Effect.gen(function* () {
        const cwd = yield* resolveWorkingDir(spec);
        return { ...(yield* environment.shell()), cwd, grid };
      }),
    command: (
      spec: TerminalLaunchSpec,
      grid: TerminalGrid,
      commandLines: TerminalCommandLines,
    ): Effect.Effect<TerminalCommandLaunchPlans, TerminalServiceError> =>
      Effect.gen(function* () {
        const cwd = yield* resolveWorkingDir(spec);
        const { shell, command } = yield* environment.command(commandLines);
        return { shell: { ...shell, cwd, grid }, command: { ...command, cwd, grid } };
      }),
  };
};
