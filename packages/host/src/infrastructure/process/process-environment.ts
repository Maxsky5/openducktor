import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { userInfo } from "node:os";
import { basename, delimiter, isAbsolute } from "node:path";
import { Data, Effect } from "effect";

const LOGIN_SHELL_ENV_MARKER_TEXT = "__OPENDUCKTOR_ENV_START__";
const LOGIN_SHELL_ENV_MARKER = `${LOGIN_SHELL_ENV_MARKER_TEXT}\0`;
const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const LOGIN_SHELL_MAX_OUTPUT_BYTES = 1024 * 1024;

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

export type ProcessEnvironmentErrorReason =
  | "invalid_output"
  | "output_limit"
  | "shell_unavailable"
  | "spawn_failed"
  | "timed_out"
  | "unexpected_exit";

export class ProcessEnvironmentError extends Data.TaggedError("ProcessEnvironmentError")<{
  readonly message: string;
  readonly reason: ProcessEnvironmentErrorReason;
  readonly shell: string;
  readonly cause?: unknown;
}> {}

export type ProcessEnvironmentResolution = {
  environment: NodeJS.ProcessEnv;
  error: ProcessEnvironmentError | null;
};

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

const minimalLoginShellEnv = (env: NodeJS.ProcessEnv, shell: string): NodeJS.ProcessEnv => ({
  HOME: env.HOME,
  LOGNAME: env.LOGNAME ?? env.USER,
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  SHELL: shell,
  TERM: "dumb",
  USER: env.USER,
});
const CSH_LOGIN_SHELL_NAMES = new Set(["csh", "tcsh"]);
const buildLoginShellPathProbeArgs = (shell: string): string[] => [
  // csh and tcsh reject `-ilc`. The login-style argv0 keeps login mode for them.
  CSH_LOGIN_SHELL_NAMES.has(basename(shell)) ? "-ic" : "-ilc",
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

const processEnvironmentError = (
  shell: string,
  reason: ProcessEnvironmentErrorReason,
  message: string,
  cause?: unknown,
): ProcessEnvironmentError =>
  cause === undefined
    ? new ProcessEnvironmentError({ shell, reason, message })
    : new ProcessEnvironmentError({ shell, reason, message, cause });

const readCurrentUserLoginShellPath = (
  env: NodeJS.ProcessEnv,
  shell: string,
  timeoutMs: number,
): Effect.Effect<string, ProcessEnvironmentError> =>
  Effect.async<string, ProcessEnvironmentError>((resume, signal) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, buildLoginShellPathProbeArgs(shell), {
        argv0: `-${basename(shell)}`,
        env: minimalLoginShellEnv(env, shell),
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (cause) {
      resume(
        Effect.fail(
          processEnvironmentError(
            shell,
            "spawn_failed",
            `Failed to resolve PATH from interactive login shell ${shell}: the shell could not start. Check that the shell exists and is executable.`,
            cause,
          ),
        ),
      );
      return;
    }

    if (!child.stdout) {
      child.kill("SIGTERM");
      resume(
        Effect.fail(
          processEnvironmentError(
            shell,
            "spawn_failed",
            `Failed to resolve PATH from interactive login shell ${shell}: the shell did not expose stdout.`,
          ),
        ),
      );
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    const finish = (effect: Effect.Effect<string, ProcessEnvironmentError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      child.removeAllListeners("error");
      child.removeAllListeners("close");
      child.stdout?.removeAllListeners("data");
      resume(effect);
    };
    const stopChild = (killSignal: NodeJS.Signals = "SIGTERM"): void => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(killSignal);
      }
    };
    const abort = (): void => {
      stopChild();
      finish(
        Effect.fail(
          processEnvironmentError(
            shell,
            "spawn_failed",
            `Failed to resolve PATH from interactive login shell ${shell}: the probe was canceled.`,
          ),
        ),
      );
    };
    const timeout = setTimeout(() => {
      stopChild("SIGKILL");
      finish(
        Effect.fail(
          processEnvironmentError(
            shell,
            "timed_out",
            `Failed to resolve PATH from interactive login shell ${shell}: the probe timed out after ${timeoutMs} ms. Check shell startup files for commands that wait for input.`,
          ),
        ),
      );
    }, timeoutMs);

    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > LOGIN_SHELL_MAX_OUTPUT_BYTES) {
        stopChild("SIGKILL");
        finish(
          Effect.fail(
            processEnvironmentError(
              shell,
              "output_limit",
              `Failed to resolve PATH from interactive login shell ${shell}: startup output exceeded ${LOGIN_SHELL_MAX_OUTPUT_BYTES} bytes. Reduce output from shell startup files.`,
            ),
          ),
        );
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.once("error", (cause) => {
      finish(
        Effect.fail(
          processEnvironmentError(
            shell,
            "spawn_failed",
            `Failed to resolve PATH from interactive login shell ${shell}: the shell could not start. Check that the shell exists and is executable.`,
            cause,
          ),
        ),
      );
    });
    child.once("close", (exitCode, exitSignal) => {
      if (exitCode !== 0) {
        const reason =
          exitCode === null ? `signal ${exitSignal ?? "unknown"}` : `exit code ${exitCode}`;
        finish(
          Effect.fail(
            processEnvironmentError(
              shell,
              "unexpected_exit",
              `Failed to resolve PATH from interactive login shell ${shell}: the probe ended with ${reason}. Fix errors in the shell startup files and restart OpenDucktor.`,
            ),
          ),
        );
        return;
      }

      const path = parsePathFromLoginShellOutput(Buffer.concat(stdoutChunks));
      finish(
        path
          ? Effect.succeed(path)
          : Effect.fail(
              processEnvironmentError(
                shell,
                "invalid_output",
                `Failed to resolve PATH from interactive login shell ${shell}: the probe returned no PATH after the environment marker. Check shell startup output and restart OpenDucktor.`,
              ),
            ),
      );
    });
  });

export const createProcessEnvironment = (
  input: CreateProcessEnvironmentInput = {},
): Effect.Effect<ProcessEnvironmentResolution> => {
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
        `Failed to resolve PATH: no executable login shell is available. Check the account login shell or set SHELL to an absolute executable path, then restart OpenDucktor. Current SHELL: ${shellName}.`,
      ),
    });
  }

  const inheritedPath = pathEnvironmentValue(env, platform);
  const loginShellPath = readLoginShellPath
    ? readLoginShellPath(env, shell)
    : readCurrentUserLoginShellPath(env, shell, loginShellTimeoutMs);
  return Effect.either(loginShellPath).pipe(
    Effect.map((result): ProcessEnvironmentResolution => {
      if (result._tag === "Left") {
        deletePathEnvironmentValue(env, platform);
        return { environment: env, error: result.left };
      }

      setPathEnvironmentValue(
        env,
        mergePathValues(result.right, inheritedPath, pathDelimiterForPlatform(platform)),
        platform,
      );
      return { environment: env, error: null };
    }),
  );
};
