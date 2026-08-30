import { z } from "zod";
import { agentSessionLiveEnvelopeSchema } from "./agent-session-live-schemas";
import { devServerEventSchema } from "./dev-server-schemas";

const runEventPayloadSchema = z.record(z.string(), z.json());

export const HOST_EVENT_CHANNELS = [
  "openducktor://run-event",
  "openducktor://dev-server-event",
  "openducktor://agent-session-live-event",
] as const;

export type HostEventChannel = (typeof HOST_EVENT_CHANNELS)[number];

export const hostEventEnvelopeSchema = z.discriminatedUnion("channel", [
  z
    .object({
      channel: z.literal("openducktor://run-event"),
      payload: runEventPayloadSchema,
    })
    .strict(),
  z
    .object({
      channel: z.literal("openducktor://dev-server-event"),
      payload: devServerEventSchema,
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
