import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { basename, delimiter, isAbsolute } from "node:path";

const LOGIN_SHELL_ENV_MARKER_TEXT = "__OPENDUCKTOR_ENV_START__";
const LOGIN_SHELL_ENV_MARKER = `${LOGIN_SHELL_ENV_MARKER_TEXT}\0`;
const LOGIN_SHELL_TIMEOUT_MS = 5_000;

export type CreateProcessEnvironmentInput = {
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  readLoginShellPath?: (env: NodeJS.ProcessEnv) => string | null;
};

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

export const mergePathValues = (
  primaryPath: string,
  secondaryPath: string | undefined,
  pathDelimiter = delimiter,
): string =>
  uniquePathEntries([
    ...primaryPath.split(pathDelimiter),
    ...(secondaryPath ?? "").split(pathDelimiter),
  ]).join(pathDelimiter);

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

export const parsePathFromLoginShellOutput = (stdout: Buffer): string | null => {
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

export const readCurrentUserLoginShellPath = (
  env: NodeJS.ProcessEnv = process.env,
): string | null => {
  const shell = currentUserShell(env);
  if (!shell) {
    return null;
  }

  const result = spawnSync(
    shell,
    ["-i", "-c", `printf '${LOGIN_SHELL_ENV_MARKER_TEXT}\\0'; /usr/bin/env -0`],
    {
      argv0: `-${basename(shell)}`,
      env: minimalLoginShellEnv(env, shell),
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: LOGIN_SHELL_TIMEOUT_MS,
    },
  );

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
  const env = { ...baseEnv };
  if (platform !== "darwin") {
    return env;
  }

  const loginShellPath = readLoginShellPath(env);
  if (loginShellPath) {
    env.PATH = mergePathValues(loginShellPath, env.PATH, pathDelimiterForPlatform(platform));
  }

  return env;
};
