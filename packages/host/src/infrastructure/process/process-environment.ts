import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { basename, delimiter, isAbsolute } from "node:path";

const LOGIN_SHELL_ENV_MARKER_TEXT = "__OPENDUCKTOR_ENV_START__";
const LOGIN_SHELL_ENV_MARKER = `${LOGIN_SHELL_ENV_MARKER_TEXT}\0`;
const LOGIN_SHELL_TIMEOUT_MS = 5_000;

const HOST_CONTROL_ENV_NAMES = [
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

export type CreateProcessEnvironmentInput = {
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readLoginShellPath?: (env: NodeJS.ProcessEnv) => string | null;
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

const currentUserShell = (env: NodeJS.ProcessEnv): string | null => {
  const shell = env.SHELL;
  if (shell && isAbsolute(shell)) {
    return shell;
  }

  try {
    const userShell = userInfo().shell;
    return userShell && isAbsolute(userShell) ? userShell : null;
  } catch {
    return null;
  }
};

const minimalLoginShellEnv = (env: NodeJS.ProcessEnv, shell: string): NodeJS.ProcessEnv => ({
  HOME: env.HOME,
  LOGNAME: env.LOGNAME ?? env.USER,
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  SHELL: shell,
  TERM: "dumb",
  USER: env.USER,
});
const buildLoginShellPathProbeArgs = (): string[] => [
  "-c",
  `printf '${LOGIN_SHELL_ENV_MARKER_TEXT}\\0'; /usr/bin/env -0`,
];
const parsePathFromLoginShellOutput = (stdout: Buffer): string | null => {
  const marker = Buffer.from(LOGIN_SHELL_ENV_MARKER);
  const markerIndex = stdout.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  const payload = stdout.subarray(markerIndex + marker.length);
  for (const entry of payload.toString("utf8").split("\0")) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex);
    if (key === "PATH") {
      return entry.slice(separatorIndex + 1);
    }
  }

  return null;
};

const readCurrentUserLoginShellPath = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const shell = currentUserShell(env);
  if (!shell) {
    return null;
  }

  const result = spawnSync(shell, buildLoginShellPathProbeArgs(), {
    argv0: `-${basename(shell)}`,
    env: minimalLoginShellEnv(env, shell),
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: LOGIN_SHELL_TIMEOUT_MS,
  });

  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    return null;
  }

  return parsePathFromLoginShellOutput(result.stdout);
};

export const createProcessEnvironment = ({
  baseEnv = process.env,
  platform = process.platform,
  readLoginShellPath = readCurrentUserLoginShellPath,
}: CreateProcessEnvironmentInput = {}): NodeJS.ProcessEnv => {
  const env = normalizeProcessEnvironment(baseEnv, platform);
  if (platform === "win32") {
    return env;
  }

  const loginShellPath = readLoginShellPath(env);
  if (loginShellPath) {
    setPathEnvironmentValue(
      env,
      mergePathValues(
        loginShellPath,
        pathEnvironmentValue(env, platform),
        pathDelimiterForPlatform(platform),
      ),
      platform,
    );
  }

  return env;
};
