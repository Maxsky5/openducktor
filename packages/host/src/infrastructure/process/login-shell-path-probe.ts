import { spawn } from "node:child_process";
import { basename } from "node:path";
import { Effect } from "effect";
import { ProcessEnvironmentError, processEnvironmentError } from "./process-environment-error";

const START_MARKER_TEXT = "__OPENDUCKTOR_ENV_START__";
const END_MARKER_TEXT = "__OPENDUCKTOR_ENV_END__";
const START_MARKER = Buffer.from(`${START_MARKER_TEXT}\0`);
const END_MARKER = Buffer.from(`${END_MARKER_TEXT}\0`);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const CSH_NAMES = new Set(["csh", "tcsh"]);

const shellEnv = (env: NodeJS.ProcessEnv, shell: string): NodeJS.ProcessEnv => ({
  HOME: env.HOME,
  LOGNAME: env.LOGNAME ?? env.USER,
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  SHELL: shell,
  TERM: "dumb",
  USER: env.USER,
});

const probeArgs = (shell: string): string[] => [
  // csh and tcsh reject `-ilc`. The login-style argv0 keeps login mode for them.
  CSH_NAMES.has(basename(shell)) ? "-ic" : "-ilc",
  `printf '${START_MARKER_TEXT}\\0'; /usr/bin/env -0; printf '${END_MARKER_TEXT}\\0'`,
];

const readPath = (stdout: Buffer): string | null => {
  const start = stdout.indexOf(START_MARKER);
  const end = stdout.indexOf(END_MARKER, start + START_MARKER.length);
  if (start < 0 || end < 0) {
    return null;
  }

  const payload = stdout.subarray(start + START_MARKER.length, end);
  for (const entry of payload.toString("utf8").split("\0")) {
    const separator = entry.indexOf("=");
    if (separator > 0 && entry.slice(0, separator) === "PATH") {
      return entry.slice(separator + 1);
    }
  }

  return null;
};

const isMissingProcess = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ESRCH";

export const probeLoginShellPath = (
  env: NodeJS.ProcessEnv,
  shell: string,
  timeoutMs: number,
): Effect.Effect<string, ProcessEnvironmentError> =>
  Effect.async<string, ProcessEnvironmentError>((resume, signal) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, probeArgs(shell), {
        argv0: `-${basename(shell)}`,
        detached: true,
        env: shellEnv(env, shell),
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

    const stopGroup = (): void => {
      const pid = child.pid;
      if (pid === undefined) {
        child.kill("SIGKILL");
        return;
      }

      try {
        // Shell startup files can leave jobs that hold stdout open, so stop the probe group.
        process.kill(-pid, "SIGKILL");
      } catch (cause) {
        if (!isMissingProcess(cause)) {
          child.kill("SIGKILL");
        }
      }
    };

    if (!child.stdout) {
      stopGroup();
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

    let stdout = Buffer.alloc(0);
    let sawEnd = false;
    let shellExited = false;
    let settled = false;

    function cleanUp(): void {
      signal.removeEventListener("abort", abort);
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      child.stdout?.removeAllListeners("data");
    }

    const finish = (effect: Effect.Effect<string, ProcessEnvironmentError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      stopGroup();
      cleanUp();
      resume(effect);
    };

    const finishWhenReady = (): void => {
      if (!sawEnd || !shellExited) {
        return;
      }

      const path = readPath(stdout);
      finish(
        path
          ? Effect.succeed(path)
          : Effect.fail(
              processEnvironmentError(
                shell,
                "invalid_output",
                `Failed to resolve PATH from interactive login shell ${shell}: the probe returned no PATH between the environment markers. Check shell startup output and restart OpenDucktor.`,
              ),
            ),
      );
    };

    function abort(): void {
      if (settled) {
        return;
      }
      settled = true;
      stopGroup();
      cleanUp();
    }

    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (sawEnd) {
        return;
      }

      stdout = Buffer.concat([stdout, chunk]);
      const end = stdout.indexOf(END_MARKER);
      if (end >= 0) {
        stdout = stdout.subarray(0, end + END_MARKER.length);
      }

      if (stdout.byteLength > MAX_OUTPUT_BYTES) {
        finish(
          Effect.fail(
            processEnvironmentError(
              shell,
              "output_limit",
              `Failed to resolve PATH from interactive login shell ${shell}: startup output exceeded ${MAX_OUTPUT_BYTES} bytes. Reduce output from shell startup files.`,
            ),
          ),
        );
        return;
      }

      if (end >= 0) {
        sawEnd = true;
        finishWhenReady();
      }
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
    child.once("exit", (exitCode, exitSignal) => {
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

      shellExited = true;
      finishWhenReady();
    });
  }).pipe(
    Effect.timeoutFail({
      duration: `${timeoutMs} millis`,
      onTimeout: () =>
        processEnvironmentError(
          shell,
          "timed_out",
          `Failed to resolve PATH from interactive login shell ${shell}: the probe timed out after ${timeoutMs} ms. Check shell startup files for commands that wait for input.`,
        ),
    }),
  );
