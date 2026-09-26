import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { toCodexModelCatalog } from "@openducktor/adapters-codex-app-server";
import { parseCodexAppServerRequestResult } from "@openducktor/contracts";
import { Effect } from "effect";
import { resolveSavedRuntimeExecutableConfig } from "../../application/runtimes/saved-runtime-executable";
import { HostOperationError, type HostError, toHostOperationError } from "../../effect/host-errors";
import { createProcessCommandLaunch } from "../../infrastructure/process/process-command-launch";
import {
  shouldStartDetachedProcessGroup,
  terminateProcessTree,
  waitForChildProcessClose,
} from "../../infrastructure/process/process-tree";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { createCodexAppServerTransport } from "./codex-app-server-transport";
import type { CodexChildProcess } from "./codex-workspace-runtime-cleanup";

const REQUEST_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 3_000;
type PreviewProcess = {
  child: CodexChildProcess;
  isClosed: () => boolean;
  transport: ReturnType<typeof createCodexAppServerTransport> | null;
};

export const createCodexModelCatalogPreview =
  ({
    settingsConfig,
    toolDiscovery,
    processEnv,
    clientVersion,
  }: {
    settingsConfig: SettingsConfigPort;
    toolDiscovery: ToolDiscoveryPort;
    processEnv: NodeJS.ProcessEnv;
    clientVersion: string;
  }) =>
  (repoPath: string) =>
    Effect.gen(function* () {
      const { executablePath: binary } = yield* resolveSavedRuntimeExecutableConfig({
        kind: "codex",
        settingsConfig,
        toolDiscovery,
      });
      const command = yield* Effect.try({
        try: () => createProcessCommandLaunch(binary, ["app-server"], processEnv, process.platform),
        catch: (cause) => toHostOperationError(cause, "codexModelCatalogPreview.command"),
      });
      let cleanupFailure: HostError | null = null;
      const result = yield* Effect.either(
        Effect.acquireUseRelease(
          Effect.try({
            try: () => {
              const child: CodexChildProcess = spawn(command.command, command.args, {
                cwd: repoPath,
                detached: shouldStartDetachedProcessGroup(process.platform),
                env: command.env,
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: command.windowsHide,
                windowsVerbatimArguments: command.windowsVerbatimArguments,
              });
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
                    REQUEST_TIMEOUT_MS,
                    () => undefined,
                  ),
                catch: (cause) => toHostOperationError(cause, "codexModelCatalogPreview.transport"),
              });
              process.transport = transport;
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
                ? terminateProcessTree({
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
                cleanupFailure = new HostOperationError({
                  operation: "codexModelCatalogPreview.cleanup",
                  message: failures.join("\n"),
                });
              }
            }),
        ),
      );
      if (cleanupFailure) return yield* Effect.fail(cleanupFailure);
      return yield* result;
    });
