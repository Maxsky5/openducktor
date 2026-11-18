import { z } from "zod";
import { sessionStartupProgressEventSchema } from "./session-startup-schemas";
import {
  agentSessionLiveEnvelopeSchema,
  type AgentSessionLiveEnvelope,
} from "./agent-session-live-schemas";
import { autopilotRunEventSchema } from "./autopilot-schemas";
import { browserHostEventSchema } from "./browser-tab-schemas";
import { azureDevOpsConnectionStateSchema } from "./azure-devops-schemas";
import { hostRuntimeEventSchema } from "./host-runtime-schemas";
import { taskMergeStatusSnapshotSchema } from "./task-merge-status-schemas";
import { workspaceSessionSchema } from "./workspace-session-schemas";

export const HOST_EVENT_CHANNELS = [
  "openducktor://session-startup-progress",
  "openducktor://run-event",
  "openducktor://agent-session-live-event",
  "openducktor://workspace-session-updated",
  "openducktor://azure-devops-connection-updated",
  "openducktor://workspace-provider-setup-updated",
  "openducktor://runtime-changed",
  "openducktor://browser-event",
  "openducktor://task-merge-status-updated",
] as const;

export type HostEventChannel = (typeof HOST_EVENT_CHANNELS)[number];

export const hostEventEnvelopeSchema = z.discriminatedUnion("channel", [
  sessionStartupProgressEventSchema,
  z.strictObject({
    channel: z.literal("openducktor://browser-event"),
    payload: browserHostEventSchema,
  }),
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
    channel: z.literal("openducktor://task-merge-status-updated"),
    payload: taskMergeStatusSnapshotSchema,
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
      payload: z.union([
        autopilotRunEventSchema,
        z.strictObject({ type: z.literal("keyboard_shortcuts_saved") }),
      ]),
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

export const BROWSER_EVENT_STREAM_NAME = "browser";
export const STARTUP_EVENT_STREAM_NAME = "startup";

export const liveSessionStreamEventName = (repoPath: string): string =>
  `agent-session-live:${JSON.stringify(repoPath)}`;

export const agentSessionLiveEnvelopeRepoPath = (envelope: AgentSessionLiveEnvelope): string => {
  switch (envelope.type) {
    case "session_operation_updated":
      return envelope.observation.ref.repoPath;
    case "submission_acknowledged":
      return envelope.acknowledgement.ref.repoPath;
    case "task_completion_updated":
      return envelope.observation.repoPath;
    case "task_session_records_updated":
    case "snapshot":
    case "fault":
      return envelope.repoPath;
    case "session_upsert":
      return envelope.session.ref.repoPath;
    case "session_removed":
    case "usage_limit_auto_resume_updated":
      return envelope.ref.repoPath;
    case "transcript_event":
      return envelope.event.sessionRef.repoPath;
    case "message_queue_updated":
      return envelope.queue.target.repoPath;
    case "catalog_invalidated":
    case "runtime_notice":
    case "slash_command_catalog_updated":
      return envelope.scope.repoPath;
  }
};

/** The host keeps a replay buffer per name. Clients can select an event by name before parsing it. */
export const hostEventStreamEventName = (envelope: HostEventEnvelope): string => {
  switch (envelope.channel) {
    case "openducktor://agent-session-live-event":
      return liveSessionStreamEventName(agentSessionLiveEnvelopeRepoPath(envelope.payload));
    case "openducktor://browser-event":
      return BROWSER_EVENT_STREAM_NAME;
    case "openducktor://session-startup-progress":
      return STARTUP_EVENT_STREAM_NAME;
    default:
      return "message";
  }
};

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
