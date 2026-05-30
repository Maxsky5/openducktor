import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Effect } from "effect";
import { toHostPathStatError } from "../../effect/host-errors";
import { pathEnvironmentValue } from "./process-environment";

const WINDOWS_DEFAULT_PATHEXT = [".EXE", ".CMD", ".BAT", ".COM"];
const WINDOWS_RUNNABLE_EXTENSIONS = new Set(WINDOWS_DEFAULT_PATHEXT);

export type ProcessCommandResolutionOptions = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  searchPath?: readonly string[];
};

const pathDelimiterForPlatform = (platform: NodeJS.Platform): string =>
  platform === "win32" ? ";" : ":";

const commandHasPath = (command: string): boolean =>
  command.includes("/") || command.includes("\\");

const hasCommandExtension = (command: string): boolean => extname(command).length > 0;

const normalizeWindowsExtension = (entry: string): string => {
  const trimmed = entry.trim();
  return (trimmed.startsWith(".") ? trimmed : `.${trimmed}`).toUpperCase();
};

const isWindowsRunnableExtension = (extension: string): boolean =>
  extension.length > 0 && WINDOWS_RUNNABLE_EXTENSIONS.has(extension.toUpperCase());

const windowsPathExt = (env: NodeJS.ProcessEnv): string[] => {
  const configured = env.PATHEXT;
  if (configured === undefined) {
    return WINDOWS_DEFAULT_PATHEXT;
  }

  const extensions = configured
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeWindowsExtension)
    .filter((extension) => WINDOWS_RUNNABLE_EXTENSIONS.has(extension));

  return extensions.length > 0 || configured.trim().length > 0
    ? extensions
    : WINDOWS_DEFAULT_PATHEXT;
};

const commandFileNames = (
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] => {
  if (platform !== "win32" || hasCommandExtension(command) || commandHasPath(command)) {
    return [command];
  }

  return windowsPathExt(env).map((extension) => `${command}${extension}`);
};

export const isExecutableCommandFile = (
  candidate: string,
  platform: NodeJS.Platform = process.platform,
) =>
  Effect.gen(function* () {
    const file = yield* Effect.tryPromise({
      try: () => stat(candidate),
      catch: (cause) => toHostPathStatError(cause, "processCommand.canExecute", candidate),
    });
    if (!file.isFile()) {
      return false;
    }
    if (platform === "win32") {
      return isWindowsRunnableExtension(extname(candidate));
    }

    yield* Effect.tryPromise({
      try: () => access(candidate, constants.X_OK),
      catch: (cause) => toHostPathStatError(cause, "processCommand.canExecute", candidate),
    });
    return true;
  }).pipe(
    Effect.catchTags({
      HostPathAccessError: () => Effect.succeed(false),
      HostPathNotFoundError: () => Effect.succeed(false),
    }),
  );

export const resolveProcessCommandPath = (
  command: string,
  { env, platform, searchPath }: ProcessCommandResolutionOptions,
) =>
  Effect.gen(function* () {
    if (commandHasPath(command)) {
      return (yield* isExecutableCommandFile(command, platform)) ? command : null;
    }

    const directories =
      searchPath ??
      pathEnvironmentValue(env, platform).split(pathDelimiterForPlatform(platform)).filter(Boolean);
    for (const directory of directories) {
      for (const fileName of commandFileNames(command, platform, env)) {
        const candidate = join(directory, fileName);
        if (yield* isExecutableCommandFile(candidate, platform)) {
          return candidate;
        }
      }
    }

    return null;
  });
