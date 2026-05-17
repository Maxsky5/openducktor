import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import type { OdtMcpBridgeService } from "../../application/mcp/odt-mcp-bridge-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { HostOperationError } from "../../effect/host-errors";
import { parseJson } from "../../effect/json";
import type { OpenCodeMcpBridgeConnection } from "../opencode/opencode-workspace-runtime-starter";
import {
  type McpBridgeDiscoveryFile,
  removeMcpBridgeDiscoveryFile,
  resolveMcpBridgeDiscoveryPath,
  writeMcpBridgeDiscoveryFile,
} from "./mcp-bridge-discovery-file";

export { resolveMcpBridgeDiscoveryPath } from "./mcp-bridge-discovery-file";

export type McpHostBridgeConnectionInput = {
  repoPath: string;
};

export type McpHostBridgeServer = {
  ensureConnection(
    input: McpHostBridgeConnectionInput,
  ): Effect.Effect<OpenCodeMcpBridgeConnection, HostOperationError>;
  ensureExternalDiscoveryReady(): Effect.Effect<void, HostOperationError>;
  close(): Effect.Effect<McpHostBridgeCloseResult, HostOperationError>;
};

export type McpHostBridgeCloseResult = {
  baseUrl: string | null;
  closed: boolean;
};

export type CreateMcpHostBridgeServerInput = {
  bridgeService: OdtMcpBridgeService;
  discoveryPath?: string;
  workspaceSettingsService: WorkspaceSettingsService;
  token?: string;
};

type StartedMcpHostBridge = {
  baseUrl: string;
  discovery: McpBridgeDiscoveryFile;
  port: number;
  server: Server;
};

const APP_TOKEN_HEADER = "x-openducktor-app-token";
const MAX_BODY_BYTES = 1024 * 1024;
const workspaceScopedToolNames = new Set<string>(ODT_WORKSPACE_SCOPED_TOOL_NAMES);

const readRequestBody = (request: IncomingMessage): Effect.Effect<unknown, HostOperationError> =>
  Effect.async<unknown, HostOperationError>((resume, signal) => {
    let body = "";
    let receivedBytes = 0;
    let settled = false;
    const finish = (effect: Effect.Effect<unknown, HostOperationError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      resume(effect);
    };
    const abort = (): void => {
      finish(
        Effect.fail(
          new HostOperationError({
            operation: "mcpHostBridge.readRequestBody",
            message: "MCP host bridge request body read was aborted.",
          }),
        ),
      );
      request.destroy();
    };
    const onData = (chunk: string): void => {
      receivedBytes += Buffer.byteLength(chunk);
      if (receivedBytes > MAX_BODY_BYTES) {
        finish(
          Effect.fail(
            new HostOperationError({
              operation: "mcpHostBridge.readRequestBody",
              message: "MCP host bridge request body exceeds 1 MiB.",
              details: { maxBodyBytes: MAX_BODY_BYTES },
            }),
          ),
        );
        request.destroy();
        return;
      }
      body += chunk;
    };
    const onEnd = (): void => {
      if (!body.trim()) {
        finish(Effect.succeed({}));
        return;
      }
      finish(
        Effect.try({
          try: () => parseJson(body),
          catch: (error) =>
            new HostOperationError({
              operation: "mcpHostBridge.readRequestBody",
              message: `Invalid JSON request body: ${error instanceof Error ? error.message : error}`,
              cause: error,
            }),
        }),
      );
    };
    const onError = (error: Error): void =>
      finish(
        Effect.fail(
          new HostOperationError({
            operation: "mcpHostBridge.readRequestBody",
            message: errorMessage(error),
            cause: error,
          }),
        ),
      );

    request.setEncoding("utf8");
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message : String(error);

const toMcpHostBridgeError = (cause: unknown, operation: string): HostOperationError =>
  cause instanceof HostOperationError
    ? cause
    : new HostOperationError({
        operation,
        message: errorMessage(cause),
        cause,
      });

const listen = (server: Server): Effect.Effect<number, HostOperationError> =>
  Effect.async<number, HostOperationError>((resume, signal) => {
    let settled = false;
    const finish = (effect: Effect.Effect<number, HostOperationError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      server.off("error", onError);
      resume(effect);
    };
    const closeThenFinish = (effect: Effect.Effect<number, HostOperationError>): void => {
      if (!server.listening) {
        finish(effect);
        return;
      }
      server.close((error) => {
        if (error) {
          finish(Effect.fail(toMcpHostBridgeError(error, "mcpHostBridge.listen.close")));
          return;
        }
        finish(effect);
      });
    };
    const abort = () =>
      closeThenFinish(
        Effect.fail(
          new HostOperationError({
            operation: "mcpHostBridge.listen",
            message: "MCP host bridge listen was aborted.",
          }),
        ),
      );
    const onError = (error: Error) =>
      finish(Effect.fail(toMcpHostBridgeError(error, "mcpHostBridge.listen")));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    server.once("error", onError);
    try {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          closeThenFinish(
            Effect.fail(
              new HostOperationError({
                operation: "mcpHostBridge.listen",
                message: "Failed to bind MCP host bridge on 127.0.0.1.",
              }),
            ),
          );
          return;
        }
        finish(Effect.succeed((address as AddressInfo).port));
      });
    } catch (error) {
      finish(Effect.fail(toMcpHostBridgeError(error, "mcpHostBridge.listen")));
    }
  });

const closeServer = (server: Server): Effect.Effect<void, HostOperationError> =>
  Effect.async<void, HostOperationError>((resume, signal) => {
    let settled = false;
    const finish = (effect: Effect.Effect<void, HostOperationError>): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      resume(effect);
    };
    const abort = () => finish(Effect.void);
    signal.addEventListener("abort", abort, { once: true });
    server.close((error) => {
      if (error) {
        finish(Effect.fail(toMcpHostBridgeError(error, "mcpHostBridge.closeServer")));
        return;
      }
      finish(Effect.void);
    });
    if (signal.aborted) {
      abort();
    }
  });

const createBridgeRequestHandler =
  (bridgeService: OdtMcpBridgeService, token: string) =>
  (request: IncomingMessage, response: ServerResponse): void => {
    const handle = Effect.gen(function* () {
      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method !== "POST" || !request.url?.startsWith("/invoke/")) {
        sendJson(response, 404, { error: "MCP host bridge endpoint not found." });
        return;
      }

      const receivedToken = request.headers[APP_TOKEN_HEADER];
      if (receivedToken !== token) {
        sendJson(response, receivedToken === undefined ? 401 : 403, {
          error:
            receivedToken === undefined
              ? "Missing OpenDucktor web host app token."
              : "Invalid OpenDucktor web host app token.",
        });
        return;
      }

      const command = decodeURIComponent(request.url.slice("/invoke/".length));
      const body = yield* readRequestBody(request);
      if (command === "odt_mcp_ready") {
        sendJson(response, 200, yield* bridgeService.ready(body));
        return;
      }
      if (command === "odt_get_workspaces") {
        sendJson(response, 200, yield* bridgeService.getWorkspaces(body));
        return;
      }

      if (!workspaceScopedToolNames.has(command)) {
        sendJson(response, 404, { error: `Unknown MCP host bridge command: ${command}` });
        return;
      }

      sendJson(
        response,
        200,
        yield* bridgeService.invoke(command as WorkspaceScopedOdtToolName, body),
      );
    });
    Effect.runPromise(handle).catch((error) => {
      sendJson(response, 400, { error: errorMessage(error) });
    });
  };

export const createMcpHostBridgeServer = ({
  bridgeService,
  discoveryPath = resolveMcpBridgeDiscoveryPath(),
  workspaceSettingsService,
  token = randomUUID(),
}: CreateMcpHostBridgeServerInput): McpHostBridgeServer => {
  let server: Server | null = null;
  let baseUrl: string | null = null;
  let publishedDiscovery: McpBridgeDiscoveryFile | null = null;
  let startupDeferred: Deferred.Deferred<
    { baseUrl: string; port: number },
    HostOperationError
  > | null = null;

  const startBridge = (): Effect.Effect<StartedMcpHostBridge, HostOperationError> =>
    Effect.gen(function* () {
      const nextServer = createServer(createBridgeRequestHandler(bridgeService, token));
      const port = yield* listen(nextServer);
      const nextBaseUrl = `http://127.0.0.1:${port}`;
      const discovery: McpBridgeDiscoveryFile = {
        hostToken: token,
        hostUrl: nextBaseUrl,
        pid: process.pid,
      };

      const publishResult = yield* Effect.either(
        writeMcpBridgeDiscoveryFile(discoveryPath, discovery).pipe(
          Effect.mapError((cause) =>
            toMcpHostBridgeError(cause, "mcpHostBridge.writeDiscoveryFile"),
          ),
        ),
      );
      if (publishResult._tag === "Left") {
        const closeResult = yield* Effect.either(
          closeServer(nextServer).pipe(
            Effect.mapError((cause) =>
              toMcpHostBridgeError(cause, "mcpHostBridge.closeUnpublishedServer"),
            ),
          ),
        );
        if (closeResult._tag === "Left") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "mcpHostBridgeServer.ensureStarted",
              message: `Failed to publish MCP host bridge discovery file and close the unpublished bridge: ${closeResult.left.message}`,
              cause: publishResult.left,
              details: { discoveryPath },
            }),
          );
        }
        return yield* Effect.fail(publishResult.left);
      }

      return {
        baseUrl: nextBaseUrl,
        discovery,
        port,
        server: nextServer,
      };
    });

  const ensureStarted = (): Effect.Effect<
    { baseUrl: string; port: number },
    HostOperationError
  > => {
    if (baseUrl) {
      return Effect.succeed({
        baseUrl,
        port: Number(new URL(baseUrl).port),
      });
    }
    if (startupDeferred) {
      return Deferred.await(startupDeferred);
    }

    return Effect.gen(function* () {
      const deferred = yield* Deferred.make<
        { baseUrl: string; port: number },
        HostOperationError
      >();
      startupDeferred = deferred;
      yield* Effect.forkDaemon(
        Effect.gen(function* () {
          const result = yield* Effect.either(
            Effect.gen(function* () {
              const started = yield* startBridge();
              server = started.server;
              baseUrl = started.baseUrl;
              publishedDiscovery = started.discovery;
              return { baseUrl: started.baseUrl, port: started.port };
            }),
          );
          if (result._tag === "Left") {
            yield* Deferred.fail(deferred, result.left);
          } else {
            yield* Deferred.succeed(deferred, result.right);
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (startupDeferred === deferred) {
                startupDeferred = null;
              }
            }),
          ),
        ),
      );
      return yield* Deferred.await(deferred);
    });
  };

  return {
    ensureConnection(input) {
      return Effect.gen(function* () {
        const repoConfig = yield* workspaceSettingsService
          .getRepoConfigByRepoPath(input.repoPath)
          .pipe(
            Effect.mapError((cause) =>
              toMcpHostBridgeError(cause, "mcpHostBridge.getRepoConfigByRepoPath"),
            ),
          );
        const connection = yield* ensureStarted();
        return {
          workspaceId: repoConfig.workspaceId,
          hostUrl: connection.baseUrl,
          hostToken: token,
        };
      });
    },
    ensureExternalDiscoveryReady() {
      return ensureStarted().pipe(Effect.asVoid);
    },
    close() {
      return Effect.gen(function* () {
        if (startupDeferred) {
          yield* Effect.either(
            Deferred.await(startupDeferred).pipe(
              Effect.mapError((cause) =>
                toMcpHostBridgeError(cause, "mcpHostBridge.awaitStartupBeforeClose"),
              ),
            ),
          );
        }
        const current = server;
        const currentBaseUrl = baseUrl;
        const currentDiscovery = publishedDiscovery;
        server = null;
        baseUrl = null;
        publishedDiscovery = null;
        if (current) {
          yield* closeServer(current);
          if (currentDiscovery !== null) {
            yield* removeMcpBridgeDiscoveryFile(discoveryPath, currentDiscovery).pipe(
              Effect.mapError((cause) =>
                toMcpHostBridgeError(cause, "mcpHostBridge.removeDiscoveryFile"),
              ),
            );
          }
          return { baseUrl: currentBaseUrl, closed: true };
        }
        return { baseUrl: null, closed: false };
      });
    },
  };
};
