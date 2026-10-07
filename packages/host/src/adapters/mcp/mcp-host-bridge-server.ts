import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type GetWorkspacesResult,
  type HostMcpBridgeStatus,
  type OdtHostBridgeReady,
  type OdtToolErrorPayload,
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import { Deferred, Effect, Exit } from "effect";
import { z } from "zod";
import type {
  OdtMcpBridgeError,
  OdtMcpBridgeService,
  WorkspaceScopedOdtToolResult,
} from "../../application/mcp/odt-mcp-bridge-service";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import {
  causeMessage,
  HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";
import type { OpenDucktorMcpBridgeConnection } from "./openducktor-mcp-environment";
import {
  type McpBridgeDiscoveryFile,
  removeMcpBridgeDiscoveryFile,
  writeMcpBridgeDiscoveryFile,
} from "./mcp-bridge-discovery-file";
import { readMcpBridgeRequestBody } from "./mcp-bridge-request-body";
import { bridgeErrorPayload, bridgeMessagePayload } from "./mcp-host-bridge-errors";

export { resolveMcpBridgeDiscoveryPath } from "./mcp-bridge-discovery-file";

export type McpHostBridgeConnectionInput = {
  repoPath: string;
};

export type McpHostBridgeServer = {
  ensureConnection(
    input: McpHostBridgeConnectionInput,
  ): Effect.Effect<OpenDucktorMcpBridgeConnection, HostOperationErrorAggregate>;
  ensureExternalDiscoveryReady(): Effect.Effect<void, HostOperationErrorAggregate>;
  /** The current bridge state. The host starts the bridge; reading the status never starts it. */
  status(): HostMcpBridgeStatus;
  close(): Effect.Effect<McpHostBridgeCloseResult, HostOperationErrorAggregate>;
};

export type McpHostBridgeCloseResult = {
  baseUrl: string | null;
  closed: boolean;
};

export type CreateMcpHostBridgeServerInput = {
  bridgeService: OdtMcpBridgeService;
  discoveryPath: string;
  workspaceSettingsService: WorkspaceSettingsService;
  /** Receives each status change, so clients see it without reading again. */
  onStatusChanged: (status: HostMcpBridgeStatus) => void;
  token?: string;
};

type StartedMcpHostBridge = {
  baseUrl: string;
  discovery: McpBridgeDiscoveryFile;
  port: number;
  server: Server;
};

type McpHostBridgeStartup = {
  deferred: Deferred.Deferred<{ baseUrl: string; port: number }, HostOperationErrorAggregate>;
};

type BridgeHttpResponse = {
  readonly body: string | undefined;
  readonly statusCode: number;
};

type BridgeHttpPayload =
  | { readonly ok: true }
  | GetWorkspacesResult
  | OdtHostBridgeReady
  | OdtToolErrorPayload
  | WorkspaceScopedOdtToolResult;

const APP_TOKEN_HEADER = "x-openducktor-app-token";
const tcpAddressSchema = z.object({ port: z.number() }).passthrough();

const isWorkspaceScopedToolName = (command: string): command is WorkspaceScopedOdtToolName =>
  ODT_WORKSPACE_SCOPED_TOOL_NAMES.some((toolName) => toolName === command);

const bridgeHttpResponse = (
  statusCode: number,
  payload: BridgeHttpPayload,
): BridgeHttpResponse => ({
  body: JSON.stringify(payload),
  statusCode,
});

const bridgeErrorResponse = (cause: OdtMcpBridgeError): BridgeHttpResponse =>
  bridgeHttpResponse(400, bridgeErrorPayload(cause, errorMessage(cause)));

const sendJson = (response: ServerResponse, { body, statusCode }: BridgeHttpResponse): void => {
  if (response.headersSent || response.writableEnded || response.destroyed) {
    return;
  }
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(body);
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error && cause.message.trim() ? cause.message : String(cause);

const toMcpHostBridgeError = (cause: unknown, operation: string): HostOperationErrorAggregate =>
  cause instanceof HostOperationError
    ? cause
    : new HostOperationError({
        operation,
        message: errorMessage(cause),
        cause,
      });

const listen = (server: Server): Effect.Effect<number, HostOperationErrorAggregate> =>
  Effect.callback<number, HostOperationErrorAggregate>((resume, signal) => {
    let settled = false;
    const finish = (effect: Effect.Effect<number, HostOperationErrorAggregate>): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      server.off("error", onError);
      resume(effect);
    };
    const closeThenFinish = (effect: Effect.Effect<number, HostOperationErrorAggregate>): void => {
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
        const address = tcpAddressSchema.safeParse(server.address());
        if (!address.success) {
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
        finish(Effect.succeed(address.data.port));
      });
    } catch (error) {
      finish(Effect.fail(toMcpHostBridgeError(error, "mcpHostBridge.listen")));
    }
  });

const closeServer = (server: Server): Effect.Effect<void, HostOperationErrorAggregate> =>
  Effect.callback<void, HostOperationErrorAggregate>((resume, signal) => {
    let settled = false;
    const finish = (effect: Effect.Effect<void, HostOperationErrorAggregate>): void => {
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
        return bridgeHttpResponse(200, { ok: true });
      }

      if (request.method !== "POST" || !request.url?.startsWith("/invoke/")) {
        return bridgeHttpResponse(404, bridgeMessagePayload("MCP host bridge endpoint not found."));
      }

      const receivedToken = request.headers[APP_TOKEN_HEADER];
      if (receivedToken !== token) {
        return bridgeHttpResponse(
          receivedToken === undefined ? 401 : 403,
          bridgeMessagePayload(
            receivedToken === undefined
              ? "Missing OpenDucktor web host app token."
              : "Invalid OpenDucktor web host app token.",
          ),
        );
      }

      const command = decodeURIComponent(request.url.slice("/invoke/".length));
      const body = yield* readMcpBridgeRequestBody(request);
      if (command === "odt_mcp_ready") {
        return bridgeHttpResponse(200, yield* bridgeService.ready(body));
      }
      if (command === "odt_get_workspaces") {
        return bridgeHttpResponse(200, yield* bridgeService.getWorkspaces(body));
      }

      if (!isWorkspaceScopedToolName(command)) {
        return bridgeHttpResponse(
          404,
          bridgeMessagePayload(`Unknown MCP host bridge command: ${command}`),
        );
      }

      return bridgeHttpResponse(200, yield* bridgeService.invoke(command, body));
    });
    Effect.runPromise(Effect.result(handle))
      .then((result) => {
        sendJson(
          response,
          result._tag === "Success" ? result.success : bridgeErrorResponse(result.failure),
        );
      })
      .catch((error) => {
        sendJson(
          response,
          bridgeErrorResponse(toMcpHostBridgeError(error, "mcpHostBridge.serializeResponse")),
        );
      });
  };

export const createMcpHostBridgeServer = ({
  bridgeService,
  discoveryPath,
  workspaceSettingsService,
  onStatusChanged,
  token = randomUUID(),
}: CreateMcpHostBridgeServerInput): McpHostBridgeServer => {
  let server: Server | null = null;
  let baseUrl: string | null = null;
  let publishedDiscovery: McpBridgeDiscoveryFile | null = null;
  let startupFlight: McpHostBridgeStartup | null = null;
  /** A failed startup stays failed. Operations that need the bridge report it; none retry it. */
  let startupFailure: string | null = null;
  const startupFailureMessage = (cause: string) =>
    `The OpenDucktor MCP host bridge did not start: ${cause} Fix the cause, then restart OpenDucktor.`;
  let status: HostMcpBridgeStatus = {
    state: "starting",
    hostUrl: null,
    failure: null,
    updatedAt: new Date().toISOString(),
    revision: 0,
  };
  const changeStatus = (change: Pick<HostMcpBridgeStatus, "state" | "hostUrl" | "failure">) => {
    status = {
      ...change,
      updatedAt: new Date().toISOString(),
      revision: status.revision + 1,
    };
    onStatusChanged(status);
  };

  const startBridge = (): Effect.Effect<StartedMcpHostBridge, HostOperationErrorAggregate> =>
    Effect.gen(function* () {
      const nextServer = createServer(createBridgeRequestHandler(bridgeService, token));
      const port = yield* listen(nextServer);
      const nextBaseUrl = `http://127.0.0.1:${port}`;
      const discovery: McpBridgeDiscoveryFile = {
        hostToken: token,
        hostUrl: nextBaseUrl,
        pid: process.pid,
      };

      const publishResult = yield* Effect.result(
        writeMcpBridgeDiscoveryFile(discoveryPath, discovery).pipe(
          Effect.mapError((cause) =>
            toMcpHostBridgeError(cause, "mcpHostBridge.writeDiscoveryFile"),
          ),
        ),
      );
      if (publishResult._tag === "Failure") {
        const closeResult = yield* Effect.result(
          closeServer(nextServer).pipe(
            Effect.mapError((cause) =>
              toMcpHostBridgeError(cause, "mcpHostBridge.closeUnpublishedServer"),
            ),
          ),
        );
        if (closeResult._tag === "Failure") {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "mcpHostBridgeServer.ensureStarted",
              message: `Failed to publish MCP host bridge discovery file and close the unpublished bridge: ${closeResult.failure.message}`,
              cause: publishResult.failure,
              details: { discoveryPath },
            }),
          );
        }
        return yield* Effect.fail(publishResult.failure);
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
    HostOperationErrorAggregate
  > =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const reservation = yield* Effect.sync(() => {
          if (baseUrl) {
            return {
              _tag: "ready" as const,
              connection: { baseUrl, port: Number(new URL(baseUrl).port) },
            };
          }
          if (startupFlight) {
            return { _tag: "existing" as const, flight: startupFlight };
          }
          if (startupFailure !== null) {
            return { _tag: "failed" as const, cause: startupFailure };
          }
          const flight: McpHostBridgeStartup = {
            deferred: Deferred.makeUnsafe(),
          };
          startupFlight = flight;
          return { _tag: "created" as const, flight };
        });

        if (reservation._tag === "ready") {
          return reservation.connection;
        }
        if (reservation._tag === "existing") {
          return yield* restore(Deferred.await(reservation.flight.deferred));
        }
        if (reservation._tag === "failed") {
          return yield* new HostOperationError({
            operation: "mcpHostBridgeServer.ensureStarted",
            message: startupFailureMessage(reservation.cause),
          });
        }

        const { flight } = reservation;
        yield* Effect.forkDetach(
          Effect.gen(function* () {
            const exit = yield* Effect.exit(
              Effect.gen(function* () {
                const started = yield* startBridge();
                server = started.server;
                baseUrl = started.baseUrl;
                publishedDiscovery = started.discovery;
                return { baseUrl: started.baseUrl, port: started.port };
              }),
            );
            if (Exit.isFailure(exit)) {
              startupFailure = causeMessage(exit.cause);
              changeStatus({
                state: "failed",
                hostUrl: null,
                failure: startupFailureMessage(startupFailure),
              });
            } else {
              changeStatus({ state: "ready", hostUrl: exit.value.baseUrl, failure: null });
            }
            yield* Deferred.done(flight.deferred, exit);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (startupFlight === flight) {
                  startupFlight = null;
                }
              }),
            ),
          ),
        );
        return yield* restore(Deferred.await(flight.deferred));
      }),
    );

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
    status: () => status,
    close() {
      return Effect.gen(function* () {
        if (startupFlight) {
          yield* Effect.result(
            Deferred.await(startupFlight.deferred).pipe(
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
