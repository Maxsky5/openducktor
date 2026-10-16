import { z } from "zod";
import { taskEventCursorSchema } from "./external-task-sync-schemas";

export const REMOTE_PROTOCOL_VERSION = 1;
export const REMOTE_BASELINE_CAPABILITIES = [
  "host.work.v1",
  "host.events.v1",
  "agent.live.v1",
  "terminal.v2",
  "work.resources.v1",
] as const;
export const REMOTE_CONNECTION_HEADER = "x-openducktor-connection-id";
export const REMOTE_TERMINAL_CONNECTION_PREFIX = "openducktor-connection.";

export const remoteHostDescriptorSchema = z.object({
  shell: z.enum(["electron", "web"]),
  appVersion: z.string().min(1),
  hostInstanceId: z.string().min(1),
  accessPolicy: z.literal("network_reach"),
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
  ]),
  message: z.string(),
  nextAction: z.string(),
  transportCause: z.enum(["network", "proxy", "tls", "timeout"]).optional(),
  host: remoteHostDescriptorSchema.optional(),
  client: remoteClientHelloSchema.optional(),
  missingCapabilities: z.array(z.object({ name: z.string(), reason: z.string() })).optional(),
  updateSide: z.enum(["client", "host", "both"]).optional(),
});
export const remoteNegotiationResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("accepted"),
    host: remoteHostDescriptorSchema,
    connectionId: z.string().uuid(),
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
export const remoteAccessConfigurationSchema = remoteAccessFieldsSchema.extend({
  publicEndpoint: remoteEndpointSchema,
});
export const remoteAccessNetworksSchema = z.array(
  z.object({ name: z.string(), address: z.string().min(1) }),
);
export const remoteAccessStateSchema = z.object({
  status: z.enum(["disabled", "starting", "available", "failed"]),
  configuration: remoteAccessConfigurationSchema.nullable(),
  failure: remoteFailureSchema.optional(),
});
export const remoteTaskLeaseSchema = z.object({
  subscriptionId: z.string().uuid(),
  replayBoundary: taskEventCursorSchema,
});
export type RemoteHostDescriptor = z.infer<typeof remoteHostDescriptorSchema>;
export type RemoteClientHello = z.infer<typeof remoteClientHelloSchema>;
export type RemoteFailure = z.infer<typeof remoteFailureSchema>;
export type RemoteNegotiationResult = z.infer<typeof remoteNegotiationResultSchema>;
export type RemoteAccessEnableInput = z.infer<typeof remoteAccessEnableInputSchema>;
export type RemoteAccessConfiguration = z.infer<typeof remoteAccessConfigurationSchema>;
export type RemoteAccessNetwork = z.infer<typeof remoteAccessNetworksSchema>[number];
export type RemoteAccessState = z.infer<typeof remoteAccessStateSchema>;
export type RemoteTaskLease = z.infer<typeof remoteTaskLeaseSchema>;
export interface RemoteAccessBridge {
  readState(): Promise<RemoteAccessState>;
  readNetworks(): Promise<RemoteAccessNetwork[]>;
  enable(input: RemoteAccessEnableInput): Promise<RemoteAccessState>;
  disable(): Promise<RemoteAccessState>;
  subscribeState(listener: (state: RemoteAccessState) => void): Promise<() => void>;
}
