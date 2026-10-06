import { type SpawnOptionsWithStdioTuple, type StdioPipe, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { toCodexModelCatalog } from "@openducktor/adapters-codex-app-server";
import { parseCodexAppServerRequestResult } from "@openducktor/contracts";
import { Effect } from "effect";
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
import { createCodexAppServerTransport } from "./codex-app-server-transport";
import type { CodexChildProcess } from "./codex-runtime-cleanup";

const REQUEST_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 3_000;
const handleEarlySpawnError = () => undefined;
type CodexPreviewSpawner = (
  command: string,
  args: string[],
  options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
) => CodexChildProcess;
type PreviewProcess = {
  child: CodexChildProcess;
  isClosed: () => boolean;
  transport: ReturnType<typeof createCodexAppServerTransport> | null;
};
type PreviewCleanup = { failure: HostError | null };

export const createCodexModelCatalogPreview =
  ({
    settingsConfig,
    toolDiscovery,
    readEnv,
    clientVersion,
    processTreeTerminator = terminateProcessTree,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    spawnProcess = spawn,
  }: {
    settingsConfig: SettingsConfigPort;
    toolDiscovery: ToolDiscoveryPort;
    readEnv: () => NodeJS.ProcessEnv;
    clientVersion: string;
    processTreeTerminator?: ProcessTreeTerminator;
    requestTimeoutMs?: number;
    spawnProcess?: CodexPreviewSpawner;
  }) =>
  (repoPath: string) =>
    Effect.gen(function* () {
      const { executablePath: binary } = yield* resolveSavedRuntimeExecutableConfig({
        kind: "codex",
        settingsConfig,
        toolDiscovery,
      });
      const command = yield* Effect.try({
        try: () => createProcessCommandLaunch(binary, ["app-server"], readEnv(), process.platform),
        catch: (cause) => toHostOperationError(cause, "codexModelCatalogPreview.command"),
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
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: command.windowsHide,
                windowsVerbatimArguments: command.windowsVerbatimArguments,
              });
              child.once("error", handleEarlySpawnError);
              let closed = false;
              child.once("close", () => {
                closed = true;
              });
              const previewProcess: PreviewProcess = {
                child,
                isClosed: () => closed,
                transport: null,
              };
              return previewProcess;
            },
            catch: (cause) => toHostOperationError(cause, "codexModelCatalogPreview.spawn"),
          }),
          (process) =>
            Effect.gen(function* () {
              const pid = process.child.pid;
              if (!pid || pid <= 0) {
                return yield* new HostOperationError({
                  operation: "codexModelCatalogPreview.spawn",
                  message: "Codex app-server started without a process ID.",
                });
              }
              const transport = yield* Effect.try({
                try: () =>
                  createCodexAppServerTransport(
                    `catalog-preview-${randomUUID()}`,
                    process.child,
                    requestTimeoutMs,
                    () => undefined,
                  ),
                catch: (cause) => toHostOperationError(cause, "codexModelCatalogPreview.transport"),
              });
              process.transport = transport;
              process.child.removeListener("error", handleEarlySpawnError);
              yield* transport.request({
                method: "initialize",
                params: {
                  clientInfo: {
                    name: "openducktor",
                    title: "OpenDucktor",
                    version: clientVersion,
                  },
                  capabilities: {
                    experimentalApi: true,
                    requestAttestation: false,
                    optOutNotificationMethods: [],
                  },
                },
              });
              yield* transport.notify({ method: "initialized" });
              const response = yield* transport.request({
                method: "model/list",
                params: {},
              });
              return yield* Effect.try({
                try: () =>
                  toCodexModelCatalog(parseCodexAppServerRequestResult("model/list", response)),
                catch: (cause) => toHostOperationError(cause, "codexModelCatalogPreview.parse"),
              });
            }),
          ({ child, transport, isClosed }) =>
            Effect.gen(function* () {
              const stop = child.pid
                ? processTreeTerminator({
                    pid: child.pid,
                    label: "Codex model catalog preview",
                    isClosed,
                    waitForExit: (timeoutMs) =>
                      waitForChildProcessClose(child, isClosed, timeoutMs),
                    stopTimeoutMs: STOP_TIMEOUT_MS,
                  })
                : Effect.sync(() => {
                    child.kill();
                  });
              const outcomes = yield* Effect.all(
                [
                  ...(transport
                    ? [Effect.either(transport.rejectPendingRequestsForShutdown())]
                    : []),
                  Effect.either(stop),
                  ...(transport ? [Effect.either(transport.close())] : []),
                ],
                { concurrency: 1 },
              );
              const failures = outcomes.flatMap((outcome) =>
                outcome._tag === "Left" ? [outcome.left.message] : [],
              );
              if (failures.length > 0) {
                cleanup.failure = new HostOperationError({
                  operation: "codexModelCatalogPreview.cleanup",
                  message: failures.join("\n"),
                });
              }
            }),
        ),
      );
      if (result._tag === "Left") {
        if (cleanup.failure) {
          return yield* new HostOperationError({
            operation: "codexModelCatalogPreview.readAndCleanup",
            message: `${result.left.message}\nCleanup also failed: ${cleanup.failure.message}`,
            cause: result.left,
          });
        }
        return yield* Effect.fail(result.left);
      }
      if (cleanup.failure) return yield* Effect.fail(cleanup.failure);
      return result.right;
    });
