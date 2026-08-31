import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";

export const NOTIFICATION_KIND_VALUES = [
  "agent.permission_requested",
  "agent.question_asked",
  "agent.session_error",
  "agent.session_started",
  "agent.session_idle",
  "workflow.spec_ready",
  "workflow.ready_for_dev",
  "workflow.in_progress",
  "workflow.blocked",
  "workflow.ai_review",
  "workflow.human_review",
  "workflow.closed",
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

export const notificationKindSchema = z.enum(NOTIFICATION_KIND_VALUES);
export const notificationCueSchema = z.enum(NOTIFICATION_CUE_VALUES);
export const notificationTargetSchema = z.enum(NOTIFICATION_TARGET_VALUES);
export const notificationSoundSchema = z.union([
  z.literal("inherit"),
  z.literal("none"),
  notificationCueSchema,
]);
export const notificationOsFocusSchema = z.enum(NOTIFICATION_OS_FOCUS_VALUES);
export const notificationSoundFocusSchema = z.enum(NOTIFICATION_SOUND_FOCUS_VALUES);

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

const DEFAULT_NOTIFICATION_KIND_SETTINGS = {
  "agent.permission_requested": { enabled: true, target: "both", sound: "inherit" },
  "agent.question_asked": { enabled: true, target: "both", sound: "inherit" },
  "agent.session_error": { enabled: true, target: "both", sound: "inherit" },
  "agent.session_started": { enabled: true, target: "in_app", sound: "inherit" },
  "agent.session_idle": { enabled: false, target: "both", sound: "inherit" },
  "workflow.spec_ready": { enabled: true, target: "both", sound: "inherit" },
  "workflow.ready_for_dev": { enabled: true, target: "both", sound: "inherit" },
  "workflow.in_progress": { enabled: true, target: "both", sound: "inherit" },
  "workflow.blocked": { enabled: true, target: "both", sound: "inherit" },
  "workflow.ai_review": { enabled: true, target: "both", sound: "inherit" },
  "workflow.human_review": { enabled: true, target: "both", sound: "inherit" },
  "workflow.closed": { enabled: true, target: "both", sound: "inherit" },
} satisfies Record<NotificationKind, NotificationKindSetting>;

export const notificationSettingsSchema = z
  .strictObject({
    globalCue: notificationCueSchema,
    volumePercent: z.number().int().min(0).max(100),
    osFocus: notificationOsFocusSchema,
    soundFocus: notificationSoundFocusSchema,
    kinds: z.record(notificationKindSchema, notificationKindSettingSchema),
  })
  .default(() => createDefaultNotificationSettings());
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export function createDefaultNotificationSettings(): NotificationSettings {
  return {
    globalCue: "chime",
    volumePercent: 30,
    osFocus: "suppress_if_focused",
    soundFocus: "mute_while_focused",
    kinds: z
      .record(notificationKindSchema, notificationKindSettingSchema)
      .parse(
        Object.fromEntries(
          NOTIFICATION_KIND_VALUES.map((kind) => [
            kind,
            { ...DEFAULT_NOTIFICATION_KIND_SETTINGS[kind] },
          ]),
        ),
      ),
  };
}

export const DEFAULT_NOTIFICATION_SETTINGS = createDefaultNotificationSettings();

const notificationRepoTargetFields = {
  repoPath: z.string().trim().min(1).max(1024),
} as const;

const notificationTaskTargetFields = {
  ...notificationRepoTargetFields,
  taskId: z.string().trim().min(1).max(128),
} as const;

const notificationSessionTargetFields = {
  ...notificationRepoTargetFields,
  taskId: z.string().trim().min(1).max(128).optional(),
} as const;

export const notificationSessionIdentitySchema = z.strictObject({
  runtimeKind: runtimeKindSchema,
  workingDirectory: z.string().trim().min(1).max(1024),
  externalSessionId: z.string().trim().min(1).max(512),
});
export type NotificationSessionIdentity = z.infer<typeof notificationSessionIdentitySchema>;

export const notificationNavigationTargetSchema = z.discriminatedUnion("type", [
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
    requestId: z.string().trim().min(1).max(512),
  }),
  z.strictObject({
    type: z.literal("session_error"),
    ...notificationSessionTargetFields,
    session: notificationSessionIdentitySchema,
    errorId: z.string().trim().min(1).max(512),
  }),
  z.strictObject({
    type: z.literal("kanban_task"),
    ...notificationTaskTargetFields,
  }),
]);
export type NotificationNavigationTarget = z.infer<typeof notificationNavigationTargetSchema>;

export const notificationOccurrenceSchema = z.strictObject({
  occurrenceId: z.string().trim().min(1).max(1024),
  kind: notificationKindSchema,
  repoPath: z.string().trim().min(1).max(1024),
  repositoryLabel: z.string().trim().min(1).max(120),
  task: z
    .strictObject({
      id: z.string().trim().min(1).max(128),
      title: z.string().trim().min(1).max(240).optional(),
    })
    .optional(),
  role: agentRoleSchema.optional(),
  sessionLabel: z.string().trim().min(1).max(120).optional(),
  status: z.string().trim().min(1).max(240),
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
  failureMessage: z.string().trim().min(1).max(500).optional(),
});
export type NotificationOsCapability = z.infer<typeof notificationOsCapabilitySchema>;

export const notificationOsDeliveryRequestSchema = z.strictObject({
  occurrenceId: z.string().trim().min(1).max(1024),
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(500),
  silent: z.literal(true),
  navigationTarget: notificationNavigationTargetSchema,
});
export type NotificationOsDeliveryRequest = z.infer<typeof notificationOsDeliveryRequestSchema>;

export const notificationDeliveryResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("shown") }),
  z.strictObject({ status: z.literal("unsupported"), message: z.string().trim().min(1).max(500) }),
  z.strictObject({ status: z.literal("denied"), message: z.string().trim().min(1).max(500) }),
  z.strictObject({ status: z.literal("failed"), message: z.string().trim().min(1).max(500) }),
]);
export type NotificationDeliveryResult = z.infer<typeof notificationDeliveryResultSchema>;

export const notificationClickEventSchema = z.strictObject({
  navigationTarget: notificationNavigationTargetSchema,
});
export type NotificationClickEvent = z.infer<typeof notificationClickEventSchema>;
