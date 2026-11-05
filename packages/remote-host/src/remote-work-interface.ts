import { WebHostRequestError } from "./effect/web-errors";
import {
  HOST_COMMAND_NAMES,
  type HostCommandInputRecord,
  REMOTE_BASELINE_CAPABILITIES,
  REMOTE_HISTORY_TOOL_DETAILS_CAPABILITY,
  REMOTE_CONNECTION_HEADER,
  REMOTE_MAX_REPLY_BYTES,
  REMOTE_PROTOCOL_VERSION,
  REMOTE_SOCKET_CONNECTION_PREFIX,
  REMOTE_SOCKET_AUTHORIZATION_PREFIX,
  TERMINAL_PROTOCOL_SUBPROTOCOL,
  HOST_CHANNEL_SUBPROTOCOL,
  remoteConnectionRequestSchema,
  remoteClientHelloSchema,
  systemListOpenInToolsRequestSchema,
  type HostErrorResponse,
  type RemoteFailure,
  type RemoteHostDescriptor,
  type RemoteNegotiationResult,
  type RemoteConnectionRequest,
  isRemotePairingFailure,
  readBearerToken,
  remoteConnectionTokenSchema,
} from "@openducktor/contracts";
import {
  createLocalAttachmentAdapter,
  hostInvokeFailureFromError,
  type EffectNodeHostCommandRouter,
} from "@openducktor/host";
import { Effect } from "effect";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RemoteAdmissionPort } from "./remote-admission";
import { localAttachmentPreviewResponse } from "./local-attachment-preview";
import { routeTaskAssetHttpRequest } from "./task-asset-http-server";
import { createTaskEventLeaseManager } from "./task-event-leases";
import { type BufferedHostEventBus } from "./host-event-bus";
import { createHostChannelSocketData, type HostChannelReply } from "./host-channel";
import type { HostWebSocketData } from "./host-websocket-handler";
import { type NodeFetchServer } from "./node-fetch-server";
import { createSocketData } from "./terminals/terminal-websocket-handler";
import type { WebLogger } from "./logger";
import { isRequestHostAllowed, allowedHostnamesFor, isLoopbackHost } from "./http-origin";

export type RemoteHostServices = Pick<
  EffectNodeHostCommandRouter,
  | "invoke"
  | "hostInstanceId"
  | "hostSettings"
  | "taskEventStream"
  | "notificationStream"
  | "terminalService"
  | "taskAssetReadService"
> & { eventBus: BufferedHostEventBus };
type Connection = {
  clientId: string;
  token: string;
  abort: AbortController;
  leases: Set<string>;
  activeStreams: number;
  expiry: ReturnType<typeof setTimeout> | null;
};
const MAX_CONNECTIONS = 128;
const MAX_LEASES_PER_CONNECTION = 32;
/** The baseline capabilities and compact session history. */
const HOST_CAPABILITIES: readonly string[] = [
  ...REMOTE_BASELINE_CAPABILITIES,
  REMOTE_HISTORY_TOOL_DETAILS_CAPABILITY,
];
/** The upgrade routes and the subprotocol that each one selects. */
const SOCKET_PROTOCOLS: ReadonlyMap<string, string> = new Map([
  ["/terminal", TERMINAL_PROTOCOL_SUBPROTOCOL],
  ["/channel", HOST_CHANNEL_SUBPROTOCOL],
]);
const WORK_COMMANDS = new Set<string>(HOST_COMMAND_NAMES);
const SHELL_COMMANDS = new Set(["open_external_url", "system_open_directory_in_tool"]);
/** Network resources observe the supplied host. They never create or dispose it. */
export const createRemoteWorkInterface = (
  services: RemoteHostServices,
  options: {
    shell: "electron" | "web";
    appVersion: string;
    /** The stable ID of this host in its settings file. */
    hostId: string;
    publicEndpoint: string;
    listenHost: string;
    frontendOrigins?: ReadonlySet<string>;
    logger: WebLogger;
    reportFailure(cause: unknown): void;
    /** Checks saved access or a pairing code, in the host admission order. */
    admission: RemoteAdmissionPort;
    onClientsChanged?(clients: ReadonlySet<string>): void;
  },
) => {
  const descriptor: RemoteHostDescriptor = {
    shell: options.shell,
    appVersion: options.appVersion,
    hostInstanceId: services.hostInstanceId,
    hostId: options.hostId,
    accessPolicy: "pairing",
    protocols: [{ version: REMOTE_PROTOCOL_VERSION, capabilities: [...HOST_CAPABILITIES] }],
  };
  const endpoint = new URL(options.publicEndpoint);
  const mountPath = endpoint.pathname.replace(/\/$/, "");
  const allowedHosts = allowedHostnamesFor({
    bindHost: options.listenHost,
    externalUrl: options.publicEndpoint,
  });
  const origins = new Set([
    endpoint.origin,
    "https://app.openducktor.dev",
    "null",
    ...(options.frontendOrigins ?? []),
  ]);
  const connections = new Map<string, Connection>();
  const leases = createTaskEventLeaseManager({
    taskEventStream: services.taskEventStream,
    reportDeliveryFailure: ({ cause }) => options.reportFailure(cause),
  });
  let closed = false;
  const clientsChanged = () =>
    options.onClientsChanged?.(
      new Set(
        [...connections.values()]
          .filter((connection) => connection.activeStreams > 0)
          .map((connection) => connection.clientId),
      ),
    );
  /** Ends a connection. A batch of releases sends one client notice at its end instead. */
  const release = (id: string, notify = true) => {
    const connection = connections.get(id);
    if (!connection) return;
    connections.delete(id);
    if (connection.expiry) clearTimeout(connection.expiry);
    connection.abort.abort();
    for (const leaseId of connection.leases) {
      const lease = leases.get(leaseId);
      if (lease) leases.delete(lease);
    }
    if (notify) clientsChanged();
  };
  const armExpiry = (id: string, connection: Connection) => {
    if (connection.expiry) clearTimeout(connection.expiry);
    connection.expiry = null;
    if (connection.activeStreams > 0) return;
    connection.expiry = setTimeout(() => release(id), 60_000);
    connection.expiry.unref?.();
  };
  const ownStream = (id: string, connection: Connection, signal: AbortSignal) => {
    connection.activeStreams += 1;
    if (connection.expiry) clearTimeout(connection.expiry);
    connection.expiry = null;
    const detach = () => {
      signal.removeEventListener("abort", detach);
      connection.activeStreams -= 1;
      // A released connection already sent its notice.
      if (connections.get(id) !== connection) return;
      armExpiry(id, connection);
      clientsChanged();
    };
    signal.addEventListener("abort", detach, { once: true });
    if (signal.aborted) detach();
    else clientsChanged();
  };
  const close = () => {
    closed = true;
    for (const id of connections.keys()) release(id, false);
    clientsChanged();
    leases.dispose();
  };
  const negotiate = (
    hello: RemoteConnectionRequest,
    proof: string | null,
  ): Effect.Effect<RemoteNegotiationResult> =>
    options.admission.run(
      Effect.gen(function* () {
        if (closed)
          return {
            status: "rejected",
            failure: failure(
              "remote_disabled",
              "Remote access is disabled.",
              "Ask the host operator to enable remote access.",
            ),
          };
        if (!hello.supportedProtocolVersions.includes(REMOTE_PROTOCOL_VERSION)) {
          let updateSide: RemoteFailure["updateSide"] = "both";
          if (hello.supportedProtocolVersions.every((version) => version > REMOTE_PROTOCOL_VERSION))
            updateSide = "host";
          else if (
            hello.supportedProtocolVersions.every((version) => version < REMOTE_PROTOCOL_VERSION)
          )
            updateSide = "client";
          return {
            status: "rejected",
            failure: {
              ...failure(
                "protocol_mismatch",
                `Client ${hello.appVersion} protocols ${hello.supportedProtocolVersions.join(", ")} do not match ${descriptor.shell} ${descriptor.appVersion} protocol ${REMOTE_PROTOCOL_VERSION}.`,
                `Update ${updateSide} to a release that supports a shared remote protocol.`,
              ),
              host: descriptor,
              client: remoteClientHelloSchema.strip().parse(hello),
              updateSide,
            },
          };
        }
        const capabilities = HOST_CAPABILITIES;
        const missing = hello.requiredCapabilities.filter((name) => !capabilities.includes(name));
        if (missing.length) {
          const legacyTerminal = missing.every((name) => name === "terminal.v2");
          return {
            status: "rejected",
            failure: {
              ...failure(
                "capability_missing",
                `Required capabilities are unavailable: ${missing.join(", ")}.`,
                legacyTerminal
                  ? "Update the client to a release that supports terminal.v3."
                  : "Update the host or use supported capabilities.",
              ),
              host: descriptor,
              client: remoteClientHelloSchema.strip().parse(hello),
              updateSide: legacyTerminal ? "client" : "host",
              missingCapabilities: missing.map((name) => ({
                name,
                reason: "This host does not implement this capability.",
              })),
            },
          };
        }
        if (connections.size >= MAX_CONNECTIONS)
          return {
            status: "rejected",
            failure: failure(
              "unavailable",
              "The host connection limit is reached.",
              "Close unused connections and retry.",
            ),
          };
        const admitted = yield* Effect.result(options.admission.authorize(hello, proof));
        if (admitted._tag === "Failure")
          return { status: "rejected", failure: admitted.failure.failure };
        const connectionId = crypto.randomUUID();
        const connectionToken = randomBytes(32).toString("base64url");
        const connection: Connection = {
          clientId: admitted.success.clientId,
          token: connectionToken,
          abort: new AbortController(),
          leases: new Set(),
          activeStreams: 0,
          expiry: null,
        };
        connections.set(connectionId, connection);
        armExpiry(connectionId, connection);
        return {
          status: "accepted",
          host: descriptor,
          connectionId,
          connectionToken,
          authorization: admitted.success.authorization,
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          missingOptionalCapabilities: hello.optionalCapabilities.filter(
            (name) => !capabilities.includes(name),
          ),
        };
      }),
    );
  /** Runs a command of a remote client. Shell functions stay with the local shell. */
  const invoke = async (
    connection: Connection,
    command: string,
    args: HostCommandInputRecord,
    signal: AbortSignal,
  ): Promise<HostChannelReply> => {
    const refused = (code: RemoteFailure["code"], message: string, nextAction: string) => ({
      error: { kind: "refused" as const, failure: failure(code, message, nextAction) },
    });
    if (SHELL_COMMANDS.has(command) || !WORK_COMMANDS.has(command))
      return refused(
        "function_unavailable",
        `Shell function ${command} is unavailable remotely.`,
        "Use the local shell for this action.",
      );
    if (closed || connection.abort.signal.aborted)
      return refused(
        "remote_disabled",
        "Remote admission ended before this command was accepted.",
        "Reconnect to an enabled host and retry this refused command.",
      );
    if (command === "system_list_open_in_tools") {
      if (!systemListOpenInToolsRequestSchema.safeParse(args).success)
        return refused(
          "invalid_protocol",
          "The open-in tools request is invalid.",
          "Update the client to the host's protocol.",
        );
      // Remote clients cannot launch host apps.
      return { result: [] };
    }
    // Only a cancelled host read stops. Other accepted work outlives the socket and listener.
    try {
      return { result: await Effect.runPromise(services.invoke(command, args), { signal }) };
    } catch (cause) {
      return { error: { kind: "host", response: hostErrorPayload(cause) } };
    }
  };
  const handle = async (
    request: Request,
    server: NodeFetchServer<HostWebSocketData>,
  ): Promise<Response | undefined> => {
    if (!isRequestHostAllowed(request, allowedHosts))
      return new Response("Request host is not allowed.", { status: 403 });
    const origin = request.headers.get("origin");
    if (origin !== null && !origins.has(origin) && !isLocalClientOrigin(origin))
      return new Response("Request origin is not allowed.", { status: 403 });
    const cors = origin
      ? {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          vary: "Origin",
        }
      : {};
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-headers": `content-type, authorization, ${REMOTE_CONNECTION_HEADER}`,
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          // Custom headers make each command preflight. Browsers reuse a preflight for 10 minutes.
          "access-control-max-age": "600",
        },
      });
    if (closed)
      return remoteFailureResponse(
        failure(
          "remote_disabled",
          "Remote access is disabled.",
          "Ask the host operator to enable remote access.",
        ),
        cors,
      );
    const url = new URL(request.url);
    // A proxy may retain the configured prefix or strip it. Both mappings are explicit at this listener.
    const route =
      mountPath && (url.pathname === mountPath || url.pathname.startsWith(`${mountPath}/`))
        ? url.pathname.slice(mountPath.length) || "/"
        : url.pathname;
    url.pathname = route;
    const routed = new Request(url, request);
    const jsonBody = async (bodyRequest: Request) => {
      if (bodyRequest.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
        throw new Error("Use application/json for remote requests.");
      return await bodyRequest.json();
    };
    try {
      if (route === "/" && request.method === "GET") return remoteJson(descriptor, 200, cors);
      if (route === "/connections" && request.method === "POST") {
        const body = await jsonBody(routed);
        const parsed = remoteConnectionRequestSchema.safeParse(body);
        let input: RemoteConnectionRequest;
        if (parsed.success) input = parsed.data;
        else {
          // Legacy hellos are read only to return the compatibility refusal, never for admission.
          const legacy = remoteClientHelloSchema.safeParse(body);
          if (
            !legacy.success ||
            legacy.data.supportedProtocolVersions.includes(REMOTE_PROTOCOL_VERSION)
          )
            throw parsed.error;
          input = { ...legacy.data, clientKind: "browser" };
        }
        const result = await Effect.runPromise(
          negotiate(input, request.headers.get("authorization")),
        );
        if (result.status === "rejected") return remoteFailureResponse(result.failure, cors);
        return remoteJson(result, 201, cors);
      }
      const socketProtocol = request.method === "GET" ? SOCKET_PROTOCOLS.get(route) : undefined;
      const protocols =
        socketProtocol === undefined
          ? []
          : (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((v) => v.trim());
      const connectionTag = protocols
        .find((v) => v.startsWith(REMOTE_SOCKET_CONNECTION_PREFIX))
        ?.slice(REMOTE_SOCKET_CONNECTION_PREFIX.length);
      const authorizationTag = protocols
        .find((v) => v.startsWith(REMOTE_SOCKET_AUTHORIZATION_PREFIX))
        ?.slice(REMOTE_SOCKET_AUTHORIZATION_PREFIX.length);
      const authorizationHeader = request.headers.get("authorization");
      const token =
        authorizationHeader === null
          ? authorizationTag
          : readBearerToken(authorizationHeader, remoteConnectionTokenSchema);
      const headerId = request.headers.get(REMOTE_CONNECTION_HEADER);
      // Browser WebSockets cannot set request headers, so they send the ID as a subprotocol.
      const id = headerId === null ? connectionTag : headerId;
      if (
        (connectionTag && headerId !== null && connectionTag !== headerId) ||
        (authorizationTag && authorizationHeader !== null && token !== authorizationTag)
      )
        return remoteFailureResponse(
          failure(
            "invalid_protocol",
            "Socket connection contexts do not agree.",
            "Use the current negotiated connection.",
          ),
          cors,
        );
      const connection = id ? connections.get(id) : undefined;
      if (!id || !connection)
        return remoteFailureResponse(
          failure(
            "connection_expired",
            "Remote compatibility negotiation is required or has expired.",
            "Connect again with supported protocol versions and capabilities.",
          ),
          cors,
        );
      if (
        !token ||
        token.length !== connection.token.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(connection.token))
      )
        return remoteFailureResponse(
          failure(
            "authorization_rejected",
            "The remote access credential is missing or invalid.",
            "Enter the current host pairing code.",
          ),
          cors,
        );
      if (route === "/connections/current" && request.method === "DELETE") {
        release(id);
        return new Response(null, { status: 204, headers: cors });
      }
      armExpiry(id, connection);
      server.bindResponseLifetime(connection.abort.signal);
      const signal = AbortSignal.any([request.signal, connection.abort.signal]);
      // Node transfers the routed body here. Only the scoped request can read it after this point.
      const scoped = new Request(routed, { signal });
      if (socketProtocol !== undefined) {
        if (
          protocols.length !== 3 ||
          protocols[0] !== socketProtocol ||
          protocols[1] !== `${REMOTE_SOCKET_CONNECTION_PREFIX}${id}` ||
          protocols[2] !== `${REMOTE_SOCKET_AUTHORIZATION_PREFIX}${token}`
        )
          return remoteFailureResponse(
            failure(
              "invalid_protocol",
              "Socket protocol and negotiated connection tag must agree.",
              `Update the client and host, then offer ${socketProtocol} and the current connection ID.`,
            ),
            cors,
          );
        ownStream(id, connection, signal);
        const upgraded = server.upgrade({
          data:
            route === "/channel"
              ? createHostChannelSocketData({
                  hostEvents: services.eventBus.stream(),
                  notifications: services.notificationStream,
                  leases,
                  ownedLeases: connection.leases,
                  maxLeases: MAX_LEASES_PER_CONNECTION,
                  invoke: (command, args, signal) => invoke(connection, command, args, signal),
                  maxReplyBytes: REMOTE_MAX_REPLY_BYTES,
                  refusal: () =>
                    closed || connection.abort.signal.aborted
                      ? failure(
                          "remote_disabled",
                          "Remote admission ended before this request was accepted.",
                          "Reconnect to an enabled host and retry this refused request.",
                        )
                      : null,
                  isShuttingDown: () => closed,
                  signal: connection.abort.signal,
                  reportFailure: options.reportFailure,
                })
              : createSocketData({
                  connectionId: crypto.randomUUID(),
                  terminalService: services.terminalService,
                  logger: options.logger,
                  onBackgroundFailure: options.reportFailure,
                  remoteSignal: connection.abort.signal,
                }),
        });
        return upgraded
          ? undefined
          : remoteFailureResponse(
              failure(
                "transport_failure",
                "WebSocket upgrade failed.",
                "Check the proxy WebSocket forwarding.",
              ),
              cors,
            );
      }
      if (route === "/local-attachment-preview" && request.method === "GET") {
        let path: string;
        try {
          const resolved = await Effect.runPromise(
            services.invoke("workspace_resolve_local_attachment_path", {
              path: url.searchParams.get("path") ?? "",
            }),
          );
          path = resolved.path;
        } catch (cause) {
          return hostFailureResponse(cause, cors);
        }
        url.searchParams.set("path", path);
        return await Effect.runPromise(
          localAttachmentPreviewResponse(
            new Request(url, scoped),
            createLocalAttachmentAdapter(),
            cors,
          ),
        );
      }
      const resource = await Effect.runPromise(
        routeTaskAssetHttpRequest({
          request: scoped,
          appToken: "",
          corsHeaders: cors,
          taskAssetReadService: services.taskAssetReadService,
          validateAppSessionCookie: () => Effect.void,
        }),
      );
      if (resource) return resource;
      return remoteFailureResponse(
        failure(
          "function_unavailable",
          "Remote function is unavailable.",
          "Use a supported work route.",
        ),
        cors,
      );
    } catch (cause) {
      if (cause instanceof WebHostRequestError)
        return remoteJson({ error: "resource_failed", message: cause.message }, cause.status, cors);
      return remoteFailureResponse(
        failure(
          "invalid_protocol",
          "The remote request is invalid.",
          "Correct the request or reconnect with the supported protocol.",
        ),
        cors,
      );
    }
  };
  return {
    handle,
    close,
    descriptor,
    revokeClient: (clientId: string) => {
      for (const [id, connection] of connections)
        if (connection.clientId === clientId) release(id, false);
      clientsChanged();
    },
  };
};

export const remoteJson = <const Payload>(
  payload: Payload,
  status = 200,
  headers: HeadersInit = {},
): Response =>
  new Response(JSON.stringify(payload ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      ...headers,
    },
  });
export const remoteFailureResponse = (
  failure: RemoteFailure,
  headers: HeadersInit = {},
): Response => {
  let status = 409;
  if (failure.code === "protocol_mismatch") status = 426;
  else if (failure.code === "invalid_protocol") status = 400;
  else if (isRemotePairingFailure(failure.code)) status = 401;
  else if (failure.code === "authorization_storage_failed") status = 503;
  else if (failure.code === "remote_disabled" || failure.code === "unavailable") status = 503;
  return remoteJson({ status: "rejected", failure }, status, headers);
};
const failure = (
  code: RemoteFailure["code"],
  message: string,
  nextAction: string,
): RemoteFailure => ({ code, message, nextAction });

const hostErrorPayload = (cause: unknown): HostErrorResponse => {
  const payload: HostErrorResponse = {
    error: "host_command_failed",
    message: cause instanceof Error ? cause.message : String(cause),
  };
  const hostFailure = hostInvokeFailureFromError(cause);
  if (hostFailure) payload.failure = hostFailure;
  return payload;
};

const hostFailureResponse = (cause: unknown, headers: HeadersInit): Response =>
  remoteJson(hostErrorPayload(cause), 500, headers);

// Local browser clients use OS-assigned ports; packaged Electron sends an opaque origin.
function isLocalClientOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}
