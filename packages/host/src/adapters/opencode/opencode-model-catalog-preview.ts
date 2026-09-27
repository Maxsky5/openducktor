import {
  type ChildProcessByStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
  spawn,
} from "node:child_process";
import type { Readable } from "node:stream";
import { loadOpencodeModelCatalogFromEndpoint } from "@openducktor/adapters-opencode-sdk";
import type { AgentModelCatalog } from "@openducktor/core";
import { Clock, Effect } from "effect";
import { resolveSavedRuntimeExecutableConfig } from "../../application/runtimes/saved-runtime-executable";
import { HostOperationError, type HostError, toHostOperationError } from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../../infrastructure/process/process-command-launch";
import {
  type ProcessTreeTerminator,
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../../infrastructure/process/process-tree";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { isOpenCodeHealthy, pickFreePort } from "./opencode-local-port";

const STARTUP_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 3_000;
type OpenCodeChild = ChildProcessByStdio<null, Readable, Readable>;
type OpenCodePreviewSpawner = (
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
) => OpenCodeChild;
type PreviewProcessState = {
  closed: boolean;
  error: Error | null;
  stderr: string;
  stdout: string;
};
type PreviewCleanup = { failure: HostError | null };

export const createOpenCodeModelCatalogPreview =
  ({
    settingsConfig,
    toolDiscovery,
    processEnv,
    portAllocator = pickFreePort,
    processTreeTerminator = terminateProcessTree,
    readinessProbe = isOpenCodeHealthy,
    readModelCatalog = loadOpencodeModelCatalogFromEndpoint,
    readTimeoutMs = 30_000,
    spawnProcess = spawn,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
  }: {
    settingsConfig: SettingsConfigPort;
    toolDiscovery: ToolDiscoveryPort;
    processEnv: NodeJS.ProcessEnv;
    portAllocator?: typeof pickFreePort;
    processTreeTerminator?: ProcessTreeTerminator;
    readinessProbe?: typeof isOpenCodeHealthy;
    readModelCatalog?: (repoPath: string, baseUrl: string) => Promise<AgentModelCatalog>;
    readTimeoutMs?: number;
    spawnProcess?: OpenCodePreviewSpawner;
    startupTimeoutMs?: number;
  }) =>
  (repoPath: string) =>
    Effect.gen(function* () {
      const { executablePath: binary } = yield* resolveSavedRuntimeExecutableConfig({
        kind: "opencode",
        settingsConfig,
        toolDiscovery,
      });
      const port = yield* portAllocator();
      const runtimeEnv: NodeJS.ProcessEnv = { ...processEnv, OPENCODE_CONFIG_CONTENT: "{}" };
      delete runtimeEnv.OPENCODE_SERVER_PASSWORD;
      delete runtimeEnv.OPENCODE_SERVER_USERNAME;
      const command = yield* Effect.try({
        try: () =>
          createProcessCommandLaunch(
            binary,
            ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
            runtimeEnv,
            process.platform,
          ),
        catch: (cause) => toHostOperationError(cause, "opencodeModelCatalogPreview.command"),
      });
      const cleanup: PreviewCleanup = { failure: null };
      const result = yield* Effect.either(
        Effect.acquireUseRelease(
          Effect.try({
            try: () => {
              const child = spawnProcess(command.command, command.args, {
                cwd: repoPath,
                detached: shouldStartDetachedProcessGroup(process.platform),
                env: command.env,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: command.windowsHide,
                windowsVerbatimArguments: command.windowsVerbatimArguments,
              });
              const state: PreviewProcessState = {
                closed: false,
                error: null,
                stderr: "",
                stdout: "",
              };
              child.once("error", (error) => {
                state.error = error;
              });
              child.once("close", () => {
                state.closed = true;
              });
              child.stderr.on("data", (chunk: Buffer) => {
                state.stderr = `${state.stderr}${chunk.toString("utf8")}`.slice(-4096);
              });
              child.stdout.on("data", (chunk: Buffer) => {
                state.stdout = `${state.stdout}${chunk.toString("utf8")}`.slice(-4096);
              });
              return { child, state };
            },
            catch: (cause) => toHostOperationError(cause, "opencodeModelCatalogPreview.spawn"),
          }),
          ({ child, state }) =>
            Effect.gen(function* () {
              if (!child.pid || child.pid <= 0) {
                return yield* new HostOperationError({
                  operation: "opencodeModelCatalogPreview.spawn",
                  message: "OpenCode server started without a process ID.",
                });
              }
              const startedAt = yield* Clock.currentTimeMillis;
              while (true) {
                if (state.error) {
                  return yield* toHostOperationError(
                    state.error,
                    "opencodeModelCatalogPreview.spawn",
                  );
                }
                if (state.closed) {
                  return yield* new HostOperationError({
                    operation: "opencodeModelCatalogPreview.start",
                    message: `OpenCode server exited before the model list was ready. ${state.stderr.trim() || state.stdout.trim()}`,
                  });
                }
                if (yield* readinessProbe(port, 250)) break;
                const elapsed = (yield* Clock.currentTimeMillis) - startedAt;
                if (elapsed >= startupTimeoutMs) {
                  return yield* new HostOperationError({
                    operation: "opencodeModelCatalogPreview.start",
                    message: `OpenCode model catalog server did not start within ${startupTimeoutMs}ms. ${state.stderr.trim() || state.stdout.trim()}`,
                  });
                }
                yield* Effect.sleep("100 millis");
              }
              return yield* Effect.tryPromise({
                try: () => readModelCatalog(repoPath, `http://127.0.0.1:${port}`),
                catch: (cause) => toHostOperationError(cause, "opencodeModelCatalogPreview.read"),
              }).pipe(
                Effect.timeoutFail({
                  duration: `${readTimeoutMs} millis`,
                  onTimeout: () =>
                    new HostOperationError({
                      operation: "opencodeModelCatalogPreview.read",
                      message: `OpenCode did not return its model catalog within ${readTimeoutMs}ms. Retry the model list.`,
                    }),
                }),
              );
            }),
          ({ child, state }) =>
            Effect.gen(function* () {
              const stop = child.pid
                ? processTreeTerminator({
                    pid: child.pid,
                    label: "OpenCode model catalog preview",
                    isClosed: () => state.closed,
                    waitForExit: (timeoutMs) =>
                      waitForChildProcessClose(child, () => state.closed, timeoutMs),
                    stopTimeoutMs: STOP_TIMEOUT_MS,
                  })
                : Effect.sync(() => {
                    child.kill();
                  });
              const outcome = yield* Effect.either(stop);
              if (outcome._tag === "Left") {
                cleanup.failure = toHostOperationError(
                  outcome.left,
                  "opencodeModelCatalogPreview.cleanup",
                );
              }
            }),
        ),
      );
      if (result._tag === "Left") {
        if (cleanup.failure) {
          return yield* new HostOperationError({
            operation: "opencodeModelCatalogPreview.readAndCleanup",
            message: `${result.left.message}\nCleanup also failed: ${cleanup.failure.message}`,
            cause: result.left,
          });
        }
        return yield* Effect.fail(result.left);
      }
      if (cleanup.failure) return yield* Effect.fail(cleanup.failure);
      return result.right;
    });
