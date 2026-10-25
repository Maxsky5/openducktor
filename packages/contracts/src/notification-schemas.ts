import { z } from "zod";
import { withMaxUtf16Length } from "./string-schemas";
import { agentSessionLiveRefSchema } from "./agent-session-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";
import { agentSessionRecordSchema } from "./session-schemas";
import { agentSessionLivePendingApprovalRequestSchema } from "./agent-session-live-schemas";

export const AGENT_NOTIFICATION_KIND_VALUES = [
  "agent.permission_requested",
  "agent.question_asked",
  "agent.session_error",
  "agent.session_started",
  "agent.session_idle",
] as const;

export const NOTIFICATION_CUE_VALUES = [
  "chime",
  "sparkle",
  "droplet",
  "bloom",
  "whisper",
  "tick",
  "press",
  "release",
  "toggle",
  "success",
  "error",
  "page",
  "loading",
  "ready",
  "pulse",
  "scan",
  "arrival",
] as const;

export const NOTIFICATION_TARGET_VALUES = ["in_app", "os", "both"] as const;
export const NOTIFICATION_OS_FOCUS_VALUES = ["suppress_if_focused", "always_send"] as const;
export const NOTIFICATION_SOUND_FOCUS_VALUES = ["mute_while_focused", "always_play"] as const;

export const agentNotificationKindSchema = z.enum(AGENT_NOTIFICATION_KIND_VALUES);
/** The notification of a workflow state. The workflow of the task names it. */
export const workflowNotificationKindSchema = z.templateLiteral(["workflow.", z.string().min(1)]);
export const notificationKindSchema = z.union([
  agentNotificationKindSchema,
  workflowNotificationKindSchema,
]);
export const notificationCueSchema = z.enum(NOTIFICATION_CUE_VALUES);
export const notificationTargetSchema = z.enum(NOTIFICATION_TARGET_VALUES);
export const notificationSoundSchema = z.union([
  z.literal("inherit"),
  z.literal("none"),
  notificationCueSchema,
]);
export const notificationOsFocusSchema = z.enum(NOTIFICATION_OS_FOCUS_VALUES);
export const notificationSoundFocusSchema = z.enum(NOTIFICATION_SOUND_FOCUS_VALUES);

export type AgentNotificationKind = z.infer<typeof agentNotificationKindSchema>;
export type WorkflowNotificationKind = z.infer<typeof workflowNotificationKindSchema>;
export type NotificationKind = z.infer<typeof notificationKindSchema>;
export type NotificationCue = z.infer<typeof notificationCueSchema>;
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;
export type NotificationSound = z.infer<typeof notificationSoundSchema>;
export type NotificationOsFocus = z.infer<typeof notificationOsFocusSchema>;
export type NotificationSoundFocus = z.infer<typeof notificationSoundFocusSchema>;

export const notificationKindSettingSchema = z.strictObject({
  enabled: z.boolean(),
  target: notificationTargetSchema,
  sound: notificationSoundSchema,
});
export type NotificationKindSetting = z.infer<typeof notificationKindSettingSchema>;

const DEFAULT_AGENT_NOTIFICATION_KIND_SETTINGS = {
  "agent.permission_requested": { enabled: true, target: "both", sound: "bloom" },
  "agent.question_asked": { enabled: true, target: "both", sound: "bloom" },
  "agent.session_error": { enabled: true, target: "both", sound: "inherit" },
  "agent.session_started": { enabled: true, target: "in_app", sound: "inherit" },
  "agent.session_idle": { enabled: false, target: "both", sound: "inherit" },
} satisfies Record<AgentNotificationKind, NotificationKindSetting>;

/** The host adds the workflow kinds of the workflow and rejects other workflow kinds. */
const notificationKindSettingsSchema = z
  .record(notificationKindSchema, notificationKindSettingSchema)
  .superRefine((kinds, context) => {
    for (const kind of AGENT_NOTIFICATION_KIND_VALUES) {
      if (kinds[kind]) continue;
      context.addIssue({ code: "custom", path: [kind], message: `Add the ${kind} setting.` });
    }
  });

export const notificationSettingsSchema = z
  .strictObject({
    globalCue: notificationCueSchema,
    volumePercent: z.number().int().min(0).max(100),
    osFocus: notificationOsFocusSchema,
    soundFocus: notificationSoundFocusSchema,
    kinds: notificationKindSettingsSchema,
  })
  .default(() => createDefaultNotificationSettings());
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** The workflow supplies the default setting of each workflow kind. */
export function createDefaultNotificationSettings(
  workflowKinds: Readonly<Partial<Record<WorkflowNotificationKind, NotificationKindSetting>>> = {},
): NotificationSettings {
  return {
    globalCue: "chime",
    volumePercent: 30,
    osFocus: "suppress_if_focused",
    soundFocus: "mute_while_focused",
    kinds: notificationKindSettingsSchema.parse({
      ...DEFAULT_AGENT_NOTIFICATION_KIND_SETTINGS,
      ...workflowKinds,
    }),
  };
}

const notificationRepoTargetFields = {
  repoPath: agentSessionLiveRefSchema.shape.repoPath,
} as const;

const notificationTaskTargetFields = {
  ...notificationRepoTargetFields,
  taskId: withMaxUtf16Length(z.string().trim().min(1), 128),
} as const;

const notificationSessionTargetFields = {
  ...notificationRepoTargetFields,
  taskId: withMaxUtf16Length(z.string().trim().min(1), 128).optional(),
} as const;

export const notificationSessionIdentitySchema = z.strictObject({
  externalSessionId: agentSessionRecordSchema.shape.externalSessionId,
  runtimeKind: agentSessionRecordSchema.shape.runtimeKind,
  workingDirectory: agentSessionRecordSchema.shape.workingDirectory,
});
export type NotificationSessionIdentity = z.infer<typeof notificationSessionIdentitySchema>;

export const notificationNavigationTargetSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("notification_settings") }),
  z.strictObject({
    type: z.literal("agent_studio_task"),
    ...notificationTaskTargetFields,
    preferredRole: agentRoleSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("agent_session"),
    ...notificationSessionTargetFields,
    session: notificationSessionIdentitySchema,
  }),
  z.strictObject({
    type: z.literal("pending_input"),
    ...notificationSessionTargetFields,
    session: notificationSessionIdentitySchema,
    inputKind: z.enum(["permission", "question"]),
    requestId: agentSessionLivePendingApprovalRequestSchema.shape.requestId,
  }),
  z.strictObject({
    type: z.literal("session_error"),
    ...notificationSessionTargetFields,
    session: notificationSessionIdentitySchema,
    errorId: withMaxUtf16Length(z.string().trim().min(1), 512),
  }),
  z.strictObject({
    type: z.literal("kanban_task"),
    ...notificationTaskTargetFields,
  }),
]);
export type NotificationNavigationTarget = z.infer<typeof notificationNavigationTargetSchema>;

export const notificationOccurrenceSchema = z.strictObject({
  occurrenceId: withMaxUtf16Length(z.string().trim().min(1), 1024),
  kind: notificationKindSchema,
  repoPath: agentSessionLiveRefSchema.shape.repoPath,
  repositoryLabel: withMaxUtf16Length(z.string().trim().min(1), 120),
  task: z
    .strictObject({
      id: withMaxUtf16Length(z.string().trim().min(1), 128),
      title: withMaxUtf16Length(z.string().trim().min(1), 240).optional(),
    })
    .optional(),
  role: agentRoleSchema.optional(),
  sessionLabel: withMaxUtf16Length(z.string().trim().min(1), 120).optional(),
  status: withMaxUtf16Length(z.string().trim().min(1), 240),
  navigationTarget: notificationNavigationTargetSchema,
});
export type NotificationOccurrence = z.infer<typeof notificationOccurrenceSchema>;

export const NOTIFICATION_OS_PLATFORM_VALUES = ["electron", "browser", "unavailable"] as const;
export const NOTIFICATION_OS_PERMISSION_VALUES = [
  "not_applicable",
  "prompt",
  "denied",
  "granted",
] as const;

export const notificationOsCapabilitySchema = z.strictObject({
  platform: z.enum(NOTIFICATION_OS_PLATFORM_VALUES),
  supported: z.boolean(),
  permission: z.enum(NOTIFICATION_OS_PERMISSION_VALUES),
  canGuaranteeSilent: z.boolean(),
  canOpenSystemSettings: z.boolean(),
  failureMessage: withMaxUtf16Length(z.string().trim().min(1), 500).optional(),
});
export type NotificationOsCapability = z.infer<typeof notificationOsCapabilitySchema>;

export const notificationOsDeliveryRequestSchema = z.strictObject({
  purpose: z.enum(["notification", "test"]).optional(),
  occurrenceId: withMaxUtf16Length(z.string().trim().min(1), 1024),
  title: withMaxUtf16Length(z.string().trim().min(1), 180),
  body: withMaxUtf16Length(z.string().trim().min(1), 500),
  silent: z.literal(true),
  navigationTarget: notificationNavigationTargetSchema,
});
export type NotificationOsDeliveryRequest = z.infer<typeof notificationOsDeliveryRequestSchema>;

export const notificationDeliveryResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("shown") }),
  z.strictObject({
    status: z.literal("unsupported"),
    message: withMaxUtf16Length(z.string().trim().min(1), 500),
  }),
  z.strictObject({
    status: z.literal("denied"),
    message: withMaxUtf16Length(z.string().trim().min(1), 500),
  }),
  z.strictObject({
    status: z.literal("failed"),
    message: withMaxUtf16Length(z.string().trim().min(1), 500),
  }),
]);
export type NotificationDeliveryResult = z.infer<typeof notificationDeliveryResultSchema>;

export const notificationClickEventSchema = z.strictObject({
  navigationTarget: notificationNavigationTargetSchema,
});
export type NotificationClickEvent = z.infer<typeof notificationClickEventSchema>;
