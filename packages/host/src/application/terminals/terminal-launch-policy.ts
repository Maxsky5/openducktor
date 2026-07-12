import type { TerminalLaunchSpec } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostPathNotFoundError } from "../../effect/host-errors";
import type { FilesystemPort } from "../../ports/filesystem-port";
import type { TerminalGrid, TerminalPtyLaunchPlan } from "../../ports/terminal-pty-port";
import { TerminalServiceError } from "./terminal-service-error";

export const TERMINAL_SECRET_ENV_NAMES = [
  "ODT_WORKSPACE_ID",
  "ODT_HOST_URL",
  "ODT_HOST_TOKEN",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "ODT_ALLOWED_TOOLS",
  "VITE_ODT_BROWSER_BACKEND_URL",
  "VITE_ODT_BROWSER_AUTH_TOKEN",
  "OPENDUCKTOR_CONTROL_TOKEN",
  "OPENDUCKTOR_APP_TOKEN",
] as const;

type TerminalLaunchPolicyInput = {
  filesystem: FilesystemPort;
  resolveEnvironment: TerminalLaunchEnvironmentPort;
};

export type TerminalLaunchEnvironment = Pick<TerminalPtyLaunchPlan, "shell" | "args" | "env">;
export type TerminalLaunchEnvironmentPort = () => Effect.Effect<
  TerminalLaunchEnvironment,
  TerminalServiceError
>;

export const createTerminalLaunchPolicy =
  ({ filesystem, resolveEnvironment }: TerminalLaunchPolicyInput) =>
  (
    spec: TerminalLaunchSpec,
    grid: TerminalGrid,
  ): Effect.Effect<TerminalPtyLaunchPlan, TerminalServiceError> =>
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
        return yield* Effect.fail(
          new TerminalServiceError({
            code: "working_directory_not_directory",
            operation: "create",
            message: `Terminal working directory is not a directory: ${canonicalWorkingDir}`,
            workingDir: canonicalWorkingDir,
          }),
        );
      }
      const environment = yield* resolveEnvironment();
      return {
        ...environment,
        cwd: canonicalWorkingDir,
        grid,
      };
    });
