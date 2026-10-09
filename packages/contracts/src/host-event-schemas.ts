import { z } from "zod";
import { agentSessionLiveEnvelopeSchema } from "./agent-session-live-schemas";
import { azureDevOpsConnectionStateSchema } from "./azure-devops-schemas";
import { hostRuntimeEventSchema } from "./host-runtime-schemas";
import { workspaceSessionSchema } from "./workspace-session-schemas";

const runEventPayloadSchema = z.record(z.string(), z.json());

export const HOST_EVENT_CHANNELS = [
  "openducktor://run-event",
  "openducktor://agent-session-live-event",
  "openducktor://workspace-session-updated",
  "openducktor://azure-devops-connection-updated",
  "openducktor://workspace-provider-setup-updated",
  "openducktor://runtime-changed",
] as const;

export type HostEventChannel = (typeof HOST_EVENT_CHANNELS)[number];

export const hostEventEnvelopeSchema = z.discriminatedUnion("channel", [
  z.strictObject({
    channel: z.literal("openducktor://workspace-provider-setup-updated"),
    payload: z.strictObject({
      setupId: z.string().uuid(),
      repoPath: z.string().min(1),
      revision: z.number().int().nonnegative(),
      configurationFingerprint: z.string().min(1),
      attemptId: z.string().uuid(),
      state: azureDevOpsConnectionStateSchema,
    }),
  }),
  z.strictObject({
    channel: z.literal("openducktor://runtime-changed"),
    payload: hostRuntimeEventSchema,
  }),
  z.strictObject({
    channel: z.literal("openducktor://azure-devops-connection-updated"),
    payload: z.strictObject({
      workspaceId: z.string().min(1),
      repoPath: z.string().min(1),
      providerId: z.literal("azure_devops"),
      configurationFingerprint: z.string().min(1),
      attemptId: z.string().uuid(),
      state: azureDevOpsConnectionStateSchema,
    }),
  }),
  z.strictObject({
    channel: z.literal("openducktor://workspace-session-updated"),
    payload: z.strictObject({ workspaceId: z.string().min(1), session: workspaceSessionSchema }),
  }),
  z
    .object({
      channel: z.literal("openducktor://run-event"),
      payload: runEventPayloadSchema,
    })
    .strict(),
  z
    .object({
      channel: z.literal("openducktor://agent-session-live-event"),
      payload: agentSessionLiveEnvelopeSchema,
    })
    .strict(),
]);

export type HostEventEnvelope = z.output<typeof hostEventEnvelopeSchema>;
export type HostEventWireEnvelope = z.input<typeof hostEventEnvelopeSchema>;
export type HostEventEnvelopeFor<Channel extends HostEventChannel> = Extract<
  HostEventEnvelope,
  { channel: Channel }
>;
export type HostEventPayload<Channel extends HostEventChannel> =
  HostEventEnvelopeFor<Channel>["payload"];

const hostEventChannelSet = new Set<string>(HOST_EVENT_CHANNELS);

export const isHostEventChannel = (value: string): value is HostEventChannel =>
  hostEventChannelSet.has(value);

export const parseHostEventChannel = (value: string): HostEventChannel => {
  if (isHostEventChannel(value)) {
    return value;
  }

  throw new Error(`Unknown OpenDucktor host event channel: ${value}`);
};

export const parseHostEventEnvelope = (value: HostEventWireEnvelope): HostEventEnvelope => {
  const parsed = hostEventEnvelopeSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error("Invalid OpenDucktor host event envelope.", { cause: parsed.error });
};
