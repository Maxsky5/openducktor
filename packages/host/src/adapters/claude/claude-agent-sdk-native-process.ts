import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Options, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import { errorMessage, HostOperationError } from "../../effect/host-errors";
import type { ClaudeSessionContext } from "./claude-agent-sdk-types";
import { withTimeout } from "./claude-agent-sdk-utils";

type ProcessState = {
  closing: boolean;
  confirmed: boolean;
  exited: Promise<void>;
  resolveExit: () => void;
  stderrTail: string;
  process?: SpawnedProcess;
};

const states = new WeakMap<ClaudeSessionContext, ProcessState>();

/** Keep actual process exit separate from the SDK's bounded query cleanup. */
export const createClaudeNativeProcessSpawner = (
  session: ClaudeSessionContext,
  stderr?: Options["stderr"],
): NonNullable<Options["spawnClaudeCodeProcess"]> => {
  const exit = Promise.withResolvers<void>();
  const state: ProcessState = {
    closing: false,
    confirmed: false,
    exited: exit.promise,
    resolveExit: exit.resolve,
    stderrTail: "",
  };
  states.set(session, state);
  return ({ command, args, cwd, env, signal }) => {
    if (state.closing) throw new Error("Claude session closed before its process started.");
    const child = spawn(command, args, {
      cwd,
      env,
      signal,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    state.process = child;
    const confirmExit = (): void => {
      state.confirmed = true;
      state.resolveExit();
    };
    child.once("exit", confirmExit);
    child.once("error", () => {
      // A failed spawn has no process to terminate. Other errors need an exit event.
      if (child.pid === undefined) confirmExit();
    });
    const decoder = new StringDecoder("utf8");
    const recordStderr = (text: string): void => {
      state.stderrTail = (state.stderrTail + text).slice(-8_192);
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
  const stderr = states.get(session)?.stderrTail.trim();
  if (stderr) {
    return new HostOperationError({
      operation: "claudeRuntime.nativeProcess",
      message: `${errorMessage(cause)}\nstderr: ${stderr}`,
      cause,
    });
  }
  return cause instanceof Error ? cause : new Error(errorMessage(cause));
};

export const beginClaudeNativeProcessClose = (session: ClaudeSessionContext): void => {
  const state = states.get(session);
  if (!state) return;
  state.closing = true;
  if (!state.process) {
    state.confirmed = true;
    state.resolveExit();
  }
};

export const isClaudeNativeProcessClosed = (session: ClaudeSessionContext): boolean =>
  states.get(session)?.confirmed ?? true;

export const waitForClaudeNativeProcessExit = async (
  session: ClaudeSessionContext,
): Promise<void> => {
  const state = states.get(session);
  if (!state) return;
  await withTimeout(
    state.exited,
    10_000,
    `Claude Code did not confirm termination for session '${session.externalSessionId}'. Inspect the Claude process, then retry Stop or restart the runtime.`,
  );
};
