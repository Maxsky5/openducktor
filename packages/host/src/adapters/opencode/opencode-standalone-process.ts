import {
  spawn,
  type ChildProcessByStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioPipe,
} from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import {
  assertOpenCodeV2Connection,
  type OpenCodeRuntimeConnection,
} from "@openducktor/adapters-opencode-sdk";
import { Effect } from "effect";
import { z } from "zod";
import {
  HostOperationError,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../../infrastructure/process/process-command-launch";
import {
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
  type ProcessTreePlatform,
  type ProcessTreeTerminator,
} from "../../infrastructure/process/process-tree";

type StandaloneChild = ChildProcessByStdio<Writable, Readable, Readable>;
export type OpenCodeStandaloneOptions = {
  readEnv?: () => NodeJS.ProcessEnv;
  platform?: ProcessTreePlatform;
  processTreeTerminator?: ProcessTreeTerminator;
  spawnProcess?: (
    command: string,
    args: string[],
    options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
  ) => StandaloneChild;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
};
export type OpenCodeStandaloneProcess = {
  waitReady: Effect.Effect<OpenCodeRuntimeConnection, HostOperationErrorAggregate>;
  isClosed: () => boolean;
  closeDescription: () => string | null;
  onClose: (listener: () => void) => () => void;
  stop: Effect.Effect<void, HostOperationErrorAggregate>;
};

/** Own the process before waiting for its first stdout line or making a request. */
export const acquireOpenCodeStandalone = (
  input: OpenCodeStandaloneOptions & {
    executablePath: string;
    workingDirectory: string;
    runtimeId: string;
  },
): Effect.Effect<OpenCodeStandaloneProcess, HostOperationErrorAggregate> =>
  Effect.try({
    try: () => {
      const platform = input.platform ?? process.platform;
      const password = randomBytes(32).toString("base64url");
      const env = { ...(input.readEnv ?? (() => process.env))(), OPENCODE_PASSWORD: password };
      const launch = createProcessCommandLaunch(
        input.executablePath,
        ["serve", "--stdio", "--port", "0", "--hostname", "127.0.0.1"],
        env,
        platform,
      );
      const child = (input.spawnProcess ?? spawn)(launch.command, launch.args, {
        cwd: input.workingDirectory,
        detached: shouldStartDetachedProcessGroup(platform),
        env: launch.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: launch.windowsHide,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
      let closed = false;
      let description: string | null = null;
      let stderr = "";
      let firstLine = "";
      let parsed = false;
      let stopped = false;
      const listeners = new Set<() => void>();
      const redact = (text: string) =>
        text
          .replaceAll(password, "[credential removed]")
          .replaceAll(
            Buffer.from(`opencode:${password}`).toString("base64"),
            "[credential removed]",
          );
      let resolveReady: (endpoint: string) => void;
      let rejectReady: (cause: unknown) => void;
      const readiness = new Promise<string>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      // The resource can be acquired before the caller starts waiting.
      readiness.catch(() => undefined);
      child.stdin.on("error", (cause) => rejectReady(cause));
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = redact(`${stderr}${chunk.toString("utf8")}`).slice(-16_384);
      });
      child.stdout.on("data", (chunk: Buffer) => {
        if (parsed) return;
        firstLine += chunk.toString("utf8");
        if (firstLine.length > 65_536) {
          parsed = true;
          rejectReady(new Error("OpenCode returned an oversized readiness line."));
          return;
        }
        const end = firstLine.indexOf("\n");
        if (end < 0) return;
        parsed = true;
        try {
          const value = z.object({ url: z.string() }).parse(JSON.parse(firstLine.slice(0, end)));
          const url = new URL(value.url);
          if (
            url.protocol !== "http:" ||
            url.hostname !== "127.0.0.1" ||
            !url.port ||
            Number(url.port) <= 0 ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            url.pathname !== "/"
          )
            throw new Error("OpenCode did not return an owned loopback server URL.");
          resolveReady(url.origin);
        } catch (cause) {
          rejectReady(cause);
        }
      });
      child.once("error", (cause) => rejectReady(cause));
      child.once("close", (code, signal) => {
        closed = true;
        description = signal
          ? `process exited from signal ${signal}`
          : `process exited with code ${code}`;
        rejectReady(new Error(`OpenCode exited before V2 readiness: ${stderr || description}`));
        for (const listener of listeners) listener();
      });
      if (!child.pid || child.pid <= 0) {
        child.stdin.end();
        child.kill();
        throw new Error("OpenCode started without a process ID. Select an OpenCode V2 executable.");
      }
      const pid = child.pid;
      return {
        isClosed: () => closed,
        closeDescription: () => description,
        onClose: (listener: () => void) => {
          listeners.add(listener);
          if (closed) listener();
          return () => {
            listeners.delete(listener);
          };
        },
        waitReady: Effect.tryPromise({
          try: async (signal) => {
            const endpoint = await readiness;
            if (closed)
              throw new Error(`OpenCode exited before authentication: ${stderr || description}`);
            const connection: OpenCodeRuntimeConnection = {
              runtimeId: input.runtimeId,
              endpoint,
              authentication: { type: "basic", username: "opencode", password },
            };
            await assertOpenCodeV2Connection(connection, signal);
            return connection;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "opencodeStandalone.start",
              message: `Cannot start OpenCode V2 with '${input.executablePath}': ${redact(cause instanceof Error ? cause.message : String(cause))}. Install or select OpenCode V2, then retry.`,
              details: { executablePath: input.executablePath },
            }),
        }).pipe(
          Effect.timeoutOrElse({
            duration: `${input.startupTimeoutMs ?? 30_000} millis`,
            orElse: () =>
              Effect.fail(
                new HostOperationError({
                  operation: "opencodeStandalone.start",
                  message: `OpenCode did not return an authenticated V2 readiness URL within ${input.startupTimeoutMs ?? 30_000}ms. Check the selected executable and retry.`,
                }),
              ),
          }),
        ),
        stop: Effect.suspend(() => {
          if (stopped) return Effect.void;
          child.stdin.end();
          return (input.processTreeTerminator ?? terminateProcessTree)({
            pid,
            label: "Owned OpenCode V2 runtime",
            isClosed: () => closed,
            waitForExit: (timeoutMs) => waitForChildProcessClose(child, () => closed, timeoutMs),
            stopTimeoutMs: input.stopTimeoutMs ?? 3_000,
          }).pipe(
            Effect.mapError((cause) => toHostOperationError(cause, "opencodeStandalone.stop")),
            Effect.tap(() =>
              Effect.sync(() => {
                stopped = true;
              }),
            ),
          );
        }),
      };
    },
    catch: (cause) =>
      toHostOperationError(cause, "opencodeStandalone.spawn", {
        executablePath: input.executablePath,
      }),
  });
