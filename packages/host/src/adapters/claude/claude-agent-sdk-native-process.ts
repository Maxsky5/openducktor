import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Options, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";
import { withTimeout } from "./claude-agent-sdk-utils";

type NativeProcessLifetime = {
  closing: boolean;
  confirmed: boolean;
  exited: Promise<void>;
  resolveExit: () => void;
  stderrTail: string;
  process?: SpawnedProcess;
};

const lifetimes = new WeakMap<ClaudeSessionContext, NativeProcessLifetime>();

/** Keep actual process exit separate from the SDK's bounded query cleanup. */
export const createClaudeNativeProcessSpawner = (
  session: ClaudeSessionContext,
  stderr?: Options["stderr"],
): NonNullable<Options["spawnClaudeCodeProcess"]> => {
  const exit = Promise.withResolvers<void>();
  const lifetime: NativeProcessLifetime = {
    closing: false,
    confirmed: false,
    exited: exit.promise,
    resolveExit: exit.resolve,
    stderrTail: "",
  };
  lifetimes.set(session, lifetime);
  return ({ command, args, cwd, env, signal }) => {
    if (lifetime.closing) throw new Error("Claude session closed before its process started.");
    const child = spawn(command, args, {
      cwd,
      env,
      signal,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    lifetime.process = child;
    const confirmExit = (): void => {
      lifetime.confirmed = true;
      lifetime.resolveExit();
    };
    child.once("exit", confirmExit);
    child.once("error", () => {
      // A failed spawn has no process to terminate. Other errors need an exit event.
      if (child.pid === undefined) confirmExit();
    });
    const decoder = new StringDecoder("utf8");
    const recordStderr = (text: string): void => {
      lifetime.stderrTail = (lifetime.stderrTail + text).slice(-8_192);
      stderr?.(text);
    };
    child.stderr.on("data", (chunk: Buffer) => recordStderr(decoder.write(chunk)));
    child.stderr.once("close", () => recordStderr(decoder.end()));
    child.stderr.on("error", (cause: Error) =>
      recordStderr(`Claude stderr read failed: ${cause.message}`),
    );
    return child;
  };
};

export const withClaudeNativeProcessDiagnostic = (
  session: ClaudeSessionContext,
  cause: unknown,
): Error => {
  const stderr = lifetimes.get(session)?.stderrTail.trim();
  return stderr
    ? new HostOperationError({
        operation: "claudeRuntime.nativeProcess",
        message: `${errorMessage(cause)}\nstderr: ${stderr}`,
        cause,
      })
    : cause instanceof Error
      ? cause
      : new Error(errorMessage(cause));
};

export const beginClaudeNativeProcessClose = (session: ClaudeSessionContext): void => {
  const lifetime = lifetimes.get(session);
  if (!lifetime) return;
  lifetime.closing = true;
  if (!lifetime.process) {
    lifetime.confirmed = true;
    lifetime.resolveExit();
  }
};

export const isClaudeNativeProcessClosed = (session: ClaudeSessionContext): boolean =>
  lifetimes.get(session)?.confirmed ?? true;

export const waitForClaudeNativeProcessExit = async (
  session: ClaudeSessionContext,
): Promise<void> => {
  const lifetime = lifetimes.get(session);
  if (!lifetime) return;
  await withTimeout(
    lifetime.exited,
    10_000,
    `Claude Code did not confirm termination for session '${session.externalSessionId}'. Inspect the Claude process, then retry Stop or restart the runtime.`,
  );
};
