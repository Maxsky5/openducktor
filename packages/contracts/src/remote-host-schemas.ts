import { z } from "zod";
import { taskEventCursorSchema } from "./external-task-sync-schemas";

export const REMOTE_PROTOCOL_VERSION = 5;
export const REMOTE_BASELINE_CAPABILITIES = [
  "host.work.v1",
  "host.events.v1",
  "agent.live.v1",
  "terminal.v3",
  "work.resources.v1",
] as const;
/**
 * The optional capability of a host that writes a heartbeat comment on each event stream. A
 * network path can drop an idle stream without closing it, so the heartbeat keeps the path busy
 * and lets the client see a silent stream.
 */
export const REMOTE_STREAM_HEARTBEAT_CAPABILITY = "streams.heartbeat.v1";
/**
 * The optional capability of a host that reads `toolDetails: "on_demand"` in a session history
 * read and serves `agent_runtime_load_session_tool_part`. A remote client asks for compact history
 * only from such a host, because an older host rejects the unknown input field.
 */
export const REMOTE_HISTORY_TOOL_DETAILS_CAPABILITY = "history.tool_details.v1";
/** The host writes a heartbeat comment on each event stream at this interval. */
export const REMOTE_STREAM_HEARTBEAT_INTERVAL_MS = 15_000;
export const REMOTE_CONNECTION_HEADER = "x-openducktor-connection-id";
/** The port that remote control offers first. The host keeps the port of each enable. */
export const DEFAULT_REMOTE_PORT = 14328;
export const REMOTE_PAIRING_CODE_LIFETIME_MS = 300_000;
export const REMOTE_TERMINAL_CONNECTION_PREFIX = "openducktor-connection.";
export const REMOTE_TERMINAL_AUTHORIZATION_PREFIX = "openducktor-authorization.";
export const REMOTE_HTTP_WARNING = "HTTP is not encrypted. Use a trusted private network or HTTPS.";
export const REMOTE_HTTP_DETAILS =
  "Anyone who intercepts a pairing code or access credential can control this host and read its data.";
export const remoteClientKindSchema = z.enum(["browser", "desktop", "mobile"]);
/** A six-digit pairing code, with leading zeroes. */
export const remotePairingCodeSchema = z.string().regex(/^\d{6}$/);
/** The token of one negotiated connection. */
export const remoteConnectionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
/** The saved access token of a paired client: its client ID, a dot, and the secret. */
export const remoteAuthorizationTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
const BEARER_PREFIX = "Bearer ";
/** The client ID and the secret of a saved access token, or null for another format. */
export const parseRemoteAuthorizationToken = (
  token: string,
): { clientId: string; secret: string } | null => {
  if (!remoteAuthorizationTokenSchema.safeParse(token).success) return null;
  const dot = token.indexOf(".");
  return { clientId: token.slice(0, dot), secret: token.slice(dot + 1) };
};
/** The token of a `Bearer` authorization header when it matches `schema`. */
export const readBearerToken = (
  header: string | null | undefined,
  schema: z.ZodString,
): string | undefined => {
  if (!header?.startsWith(BEARER_PREFIX)) return undefined;
  const parsed = schema.safeParse(header.slice(BEARER_PREFIX.length));
  return parsed.success ? parsed.data : undefined;
};
export const remoteAuthorizationSchema = z.object({
  hostId: z.string().uuid(),
  clientId: z.string().uuid(),
  token: remoteAuthorizationTokenSchema,
});

export const remoteHostDescriptorSchema = z.object({
  shell: z.enum(["electron", "web"]),
  appVersion: z.string().min(1),
  hostInstanceId: z.string().min(1),
  /** The stable identity of this host's approval scope. Legacy hosts may omit it. */
  hostId: z.string().min(1).optional(),
  accessPolicy: z.enum(["network_reach", "pairing"]),
  protocols: z.array(
    z.object({ version: z.number().int().positive(), capabilities: z.array(z.string()) }),
  ),
});
export const remoteClientHelloSchema = z
  .object({
    appVersion: z.string().min(1),
    supportedProtocolVersions: z.array(z.number().int().positive()).min(1).max(32),
    requiredCapabilities: z.array(z.string().min(1)).max(64),
    optionalCapabilities: z.array(z.string().min(1)).max(64),
  })
  .strict();
export const remoteConnectionRequestSchema = remoteClientHelloSchema.extend({
  clientKind: remoteClientKindSchema,
  pairingCode: z.string().max(128).optional(),
});
export const remoteFailureSchema = z.object({
  code: z.enum([
    "invalid_endpoint",
    "unavailable",
    "remote_disabled",
    "protocol_mismatch",
    "capability_missing",
    "function_unavailable",
    "connection_expired",
    "invalid_protocol",
    "transport_failure",
    "synchronization_failed",
    "outcome_unknown",
    "consumer_overflow",
    "port_in_use",
    "authorization_required",
    "authorization_rejected",
    "pairing_refused",
    "authorization_storage_failed",
  ]),
  message: z.string(),
  nextAction: z.string(),
  transportCause: z.enum(["network", "proxy", "tls", "timeout", "local_network"]).optional(),
  host: remoteHostDescriptorSchema.optional(),
  client: remoteClientHelloSchema.optional(),
  missingCapabilities: z.array(z.object({ name: z.string(), reason: z.string() })).optional(),
  updateSide: z.enum(["client", "host", "both"]).optional(),
});
/** The reason and the next action of a remote failure, as one sentence pair. */
export const remoteFailureText = (failure: Pick<RemoteFailure, "message" | "nextAction">): string =>
  `${failure.message} ${failure.nextAction}`;
const REMOTE_PAIRING_FAILURES: ReadonlySet<RemoteFailure["code"] | undefined> = new Set<
  RemoteFailure["code"] | undefined
>(["authorization_required", "authorization_rejected", "pairing_refused"]);
/** True for a failure that a new pairing code can solve. */
export const isRemotePairingFailure = (code: RemoteFailure["code"] | undefined): boolean =>
  REMOTE_PAIRING_FAILURES.has(code);

export const remoteNegotiationResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("accepted"),
    host: remoteHostDescriptorSchema,
    connectionId: z.string().uuid(),
    connectionToken: remoteConnectionTokenSchema,
    authorization: remoteAuthorizationSchema.optional(),
    protocolVersion: z.number().int().positive(),
    missingOptionalCapabilities: z.array(z.string()),
  }),
  z.object({ status: z.literal("rejected"), failure: remoteFailureSchema }),
]);

export const remoteEndpointSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      const host = url.hostname.replace(/\.$/, "");
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.port === "0" ||
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.startsWith("127.") ||
        ["[::1]", "0.0.0.0", "[::]", "[::ffff:0:0]"].includes(host) ||
        host.startsWith("[::ffff:7f") ||
        url.pathname.includes("//")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Enter an http or https host address that other devices can reach. Do not include a password, query, fragment, wildcard, or loopback address.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a full host address, such as https://your-computer.example.",
      });
    }
  });
const remoteAccessFieldsSchema = z
  .object({
    listenHost: z
      .string()
      .min(1)
      .refine((value) => {
        try {
          const host = value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
          const url = new URL(`http://${host}`);
          return url.href === `http://${url.hostname}/`;
        } catch {
          return false;
        }
      }, "Enter a listening hostname or IP address without a scheme, port, or path."),
    // Zero asks the operating system to choose a free port.
    listenPort: z.number().int().min(0).max(65535),
    publicEndpoint: remoteEndpointSchema.optional(),
    webOrigins: z
      .array(
        z.string().refine((value) => {
          try {
            const url = new URL(value);
            return ["http:", "https:"].includes(url.protocol) && url.origin === value;
          } catch {
            return false;
          }
        }, "Enter a web app origin such as https://app.example, without a path or trailing slash."),
      )
      .max(32)
      .optional(),
  })
  .strict();
export const remoteAccessEnableInputSchema = remoteAccessFieldsSchema.superRefine(
  (input, context) => {
    if (input.publicEndpoint !== undefined) {
      if (input.listenPort === 0)
        context.addIssue({
          code: "custom",
          path: ["listenPort"],
          message: "Use a fixed port with a public host address.",
        });
      return;
    }
    const host =
      input.listenHost.includes(":") && !input.listenHost.startsWith("[")
        ? `[${input.listenHost}]`
        : input.listenHost;
    if (!remoteEndpointSchema.safeParse(`http://${host}`).success) {
      context.addIssue({
        code: "custom",
        path: ["listenHost"],
        message:
          "Choose a network address that other devices can reach, or enter a public host address in Advanced.",
      });
    }
  },
);
/**
 * The remote control settings in the settings file. `configuration` is the listener of the last
 * enable with the port that it bound, so a restart and the next enable keep the same address.
 */
export const remoteAccessSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  configuration: remoteAccessEnableInputSchema
    .refine((configuration) => configuration.listenPort > 0, {
      path: ["listenPort"],
      message: "A saved remote control listener has a fixed port.",
    })
    .nullable(),
});
export const DEFAULT_REMOTE_ACCESS_SETTINGS = { enabled: false, configuration: null } as const;
export const remoteAccessConfigurationSchema = remoteAccessFieldsSchema.extend({
  publicEndpoint: remoteEndpointSchema,
});
export const remoteAccessNetworksSchema = z.array(
  z.object({ name: z.string(), address: z.string().min(1) }),
);
export const remoteAccessStateSchema = z.object({
  status: z.enum(["disabled", "starting", "available", "failed"]),
  configuration: remoteAccessConfigurationSchema.nullable(),
  pairing: z.object({ code: remotePairingCodeSchema, expiresAt: z.iso.datetime() }).nullable(),
  /** Why the last pairing window closed, while no window is open. */
  pairingEnd: z.enum(["paired", "expired", "refused", "stopped"]).optional(),
  clients: z
    .array(
      z.object({
        clientId: z.string().uuid(),
        kind: remoteClientKindSchema,
        reference: z.string(),
        status: z.enum(["connected", "offline"]),
      }),
    )
    .nullable(),
  connectedClients: z.number().int().nonnegative().nullable(),
  failure: remoteFailureSchema.optional(),
});
export const remoteTaskLeaseSchema = z.object({
  subscriptionId: z.string().uuid(),
  replayBoundary: taskEventCursorSchema,
});
export type RemoteHostDescriptor = z.infer<typeof remoteHostDescriptorSchema>;
export type RemoteAuthorization = z.infer<typeof remoteAuthorizationSchema>;
export type RemoteClientKind = z.infer<typeof remoteClientKindSchema>;
export type RemoteConnectionRequest = z.infer<typeof remoteConnectionRequestSchema>;
export type RemoteApprovedClient = NonNullable<
  z.infer<typeof remoteAccessStateSchema>["clients"]
>[number];
export const remotePairingQrSchema = z
  .object({
    type: z.literal("openducktor-pairing"),
    version: z.literal(1),
    endpoint: remoteEndpointSchema,
    code: remotePairingCodeSchema,
  })
  .strict();
export type RemotePairingQr = z.infer<typeof remotePairingQrSchema>;
export type RemoteClientHello = z.infer<typeof remoteClientHelloSchema>;
export type RemoteFailure = z.infer<typeof remoteFailureSchema>;
export type RemoteNegotiationResult = z.infer<typeof remoteNegotiationResultSchema>;
export type RemoteAccessEnableInput = z.infer<typeof remoteAccessEnableInputSchema>;
export type RemoteAccessConfiguration = z.infer<typeof remoteAccessConfigurationSchema>;
export type RemoteAccessNetwork = z.infer<typeof remoteAccessNetworksSchema>[number];
export type RemoteAccessState = z.infer<typeof remoteAccessStateSchema>;
/** A failed remote control: no pairing window, and devices that the host cannot report. */
export const failedRemoteAccessState = (
  failure: RemoteFailure,
  configuration: RemoteAccessConfiguration | null = null,
): RemoteAccessState => ({
  status: "failed",
  configuration,
  pairing: null,
  clients: null,
  connectedClients: null,
  failure,
});
export type RemotePairingEnd = NonNullable<RemoteAccessState["pairingEnd"]>;
export type RemoteAccessSettings = z.infer<typeof remoteAccessSettingsSchema>;
export type RemoteTaskLease = z.infer<typeof remoteTaskLeaseSchema>;
export const remotePairingStartInputSchema = z.strictObject({ renew: z.boolean().optional() });
export type RemotePairingStartInput = z.infer<typeof remotePairingStartInputSchema>;
export interface RemoteAccessBridge {
  readState(): Promise<RemoteAccessState>;
  readNetworks(): Promise<RemoteAccessNetwork[]>;
  enable(input: RemoteAccessEnableInput): Promise<RemoteAccessState>;
  disable(): Promise<RemoteAccessState>;
  revokeClient(clientId: string): Promise<RemoteAccessState>;
  /**
   * Opens a five-minute pairing window with a new single-use code. `renew` asks for the next code
   * of an expired window: the count of wrong codes then stays.
   */
  startPairing(options?: RemotePairingStartInput): Promise<RemoteAccessState>;
  /** Closes the open pairing window. */
  stopPairing(): Promise<RemoteAccessState>;
  subscribeState(listener: (state: RemoteAccessState) => void): Promise<() => void>;
}
