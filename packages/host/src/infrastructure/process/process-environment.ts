import { accessSync, constants } from "node:fs";
import { userInfo } from "node:os";
import { basename, delimiter, isAbsolute } from "node:path";
import { Effect } from "effect";
import type { UserEnvironmentResolution } from "../../ports/user-environment-port";
import { probeLoginShellPath } from "./login-shell-path-probe";
import { ProcessEnvironmentError, processEnvironmentError } from "./process-environment-error";

const LOGIN_SHELL_TIMEOUT_MS = 15_000;

const HOST_CONTROL_ENV_NAMES = [
  "ODT_WORKSPACE_ID",
  "ODT_HOST_URL",
  "ODT_HOST_TOKEN",
  "ODT_HOST_TOKEN_FILE",
  "ODT_FORBID_WORKSPACE_ID_INPUT",
  "ODT_ALLOWED_TOOLS",
  "VITE_ODT_BROWSER_BACKEND_URL",
  "VITE_ODT_BROWSER_AUTH_TOKEN",
  "OPENDUCKTOR_CONTROL_TOKEN",
  "OPENDUCKTOR_APP_TOKEN",
] as const;

export type ReadUserShell = () => string | null;

export { ProcessEnvironmentError } from "./process-environment-error";

export type ReadLoginShellPath = (
  env: NodeJS.ProcessEnv,
  shell: string,
) => Effect.Effect<string, ProcessEnvironmentError>;

export type CreateProcessEnvironmentInput = {
  baseEnv?: NodeJS.ProcessEnv;
  loginShellTimeoutMs?: number;
  platform?: NodeJS.Platform;
  readLoginShellPath?: ReadLoginShellPath;
  readUserShell?: ReadUserShell;
};

const isPathKey = (key: string): boolean => key.toLowerCase() === "path";

const pathDelimiterForPlatform = (platform: NodeJS.Platform): ":" | ";" =>
  platform === "win32" ? ";" : ":";

const uniquePathEntries = (entries: Iterable<string>): string[] => {
  const nextEntries: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    if (!seen.has(entry)) {
      nextEntries.push(entry);
      seen.add(entry);
    }
  }

  return nextEntries;
};
const mergePathValues = (
  primaryPath: string,
  secondaryPath: string | undefined,
  pathDelimiter = delimiter,
): string =>
  uniquePathEntries([
    ...primaryPath.split(pathDelimiter),
    ...(secondaryPath ?? "").split(pathDelimiter),
  ]).join(pathDelimiter);
const pathEnvironmentKey = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string => {
  if (platform !== "win32") {
    return "PATH";
  }

  return (
    Object.keys(env).find((key) => key === "PATH") ??
    Object.keys(env).find((key) => key === "Path") ??
    Object.keys(env).find(isPathKey) ??
    "Path"
  );
};

export const pathEnvironmentValue = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string => env[pathEnvironmentKey(env, platform)] ?? "";

export const normalizeProcessEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  const next = { ...env };
  if (platform !== "win32") {
    return next;
  }

  const pathKey = pathEnvironmentKey(env, platform);
  const pathValue = env[pathKey];
  for (const key of Object.keys(next)) {
    if (isPathKey(key)) {
      delete next[key];
    }
  }
  if (pathValue !== undefined) {
    next.Path = pathValue;
  }
  return next;
};

export const sanitizeChildProcessEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  const next = normalizeProcessEnvironment(env, platform);
  const controlNames = new Set<string>(HOST_CONTROL_ENV_NAMES);
  for (const name of Object.keys(next)) {
    const comparableName = platform === "win32" ? name.toUpperCase() : name;
    if (controlNames.has(comparableName)) {
      delete next[name];
    }
  }
  return next;
};

const setPathEnvironmentValue = (
  env: NodeJS.ProcessEnv,
  value: string,
  platform: NodeJS.Platform,
): void => {
  if (platform === "win32") {
    for (const key of Object.keys(env)) {
      if (isPathKey(key)) {
        delete env[key];
      }
    }
    env.Path = value;
    return;
  }

  env.PATH = value;
};

const deletePathEnvironmentValue = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): void => {
  for (const key of Object.keys(env)) {
    if ((platform === "win32" && isPathKey(key)) || key === "PATH") {
      delete env[key];
    }
  }
};

export const accountUserShell = (): string | null => {
  try {
    return userInfo().shell || null;
  } catch {
    return null;
  }
};

const NON_INTERACTIVE_SHELL_NAMES = new Set(["nologin", "false"]);

const isUsableLoginShell = (shell: string): boolean => {
  if (!isAbsolute(shell) || NON_INTERACTIVE_SHELL_NAMES.has(basename(shell))) {
    return false;
  }

  try {
    accessSync(shell, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const resolveUserLoginShell = (
  env: NodeJS.ProcessEnv,
  readUserShell: ReadUserShell = accountUserShell,
): string | null => {
  const accountShell = readUserShell();
  if (accountShell && isUsableLoginShell(accountShell)) {
    return accountShell;
  }

  const shell = env.SHELL;
  return shell && isUsableLoginShell(shell) ? shell : null;
};

export const createProcessEnvironment = (
  input: CreateProcessEnvironmentInput = {},
): Effect.Effect<UserEnvironmentResolution> => {
  const {
    baseEnv = process.env,
    loginShellTimeoutMs = LOGIN_SHELL_TIMEOUT_MS,
    platform = process.platform,
    readUserShell = accountUserShell,
    readLoginShellPath,
  } = input;
  const env = normalizeProcessEnvironment(baseEnv, platform);
  if (platform === "win32") {
    return Effect.succeed({ environment: env, error: null });
  }

  const shell = resolveUserLoginShell(env, readUserShell);
  if (shell) {
    env.SHELL = shell;
  }

  if (!shell) {
    const shellName = env.SHELL?.trim() || "unknown";
    deletePathEnvironmentValue(env, platform);
    return Effect.succeed({
      environment: env,
      error: processEnvironmentError(
        shellName,
        "shell_unavailable",
        `Failed to resolve PATH: no executable login shell is available. Fix the account login shell, then select Refresh in Diagnostics. If you set SHELL to an absolute executable path instead, restart OpenDucktor. Current SHELL: ${shellName}.`,
      ),
    });
  }

  const inheritedPath = pathEnvironmentValue(env, platform);
  const probeEnv = sanitizeChildProcessEnvironment(env, platform);
  const loginShellPath = readLoginShellPath
    ? readLoginShellPath(probeEnv, shell)
    : probeLoginShellPath(probeEnv, shell, loginShellTimeoutMs);
  return Effect.result(loginShellPath).pipe(
    Effect.map((result): UserEnvironmentResolution => {
      if (result._tag === "Failure") {
        deletePathEnvironmentValue(env, platform);
        return { environment: env, error: result.failure };
      }

      setPathEnvironmentValue(
        env,
        mergePathValues(result.success, inheritedPath, pathDelimiterForPlatform(platform)),
        platform,
      );
      return { environment: env, error: null };
    }),
  );
};
