import { z } from "zod";

export const appUpdateStatusValues = [
  "disabled",
  "idle",
  "checking",
  "upToDate",
  "available",
  "downloading",
  "downloaded",
  "error",
] as const;
export const appUpdateStatusSchema = z.enum(appUpdateStatusValues);
export type AppUpdateStatus = z.infer<typeof appUpdateStatusSchema>;

export const appUpdateCheckInitiatorValues = ["background", "settings", "menu"] as const;
export const appUpdateCheckInitiatorSchema = z.enum(appUpdateCheckInitiatorValues);
export type AppUpdateCheckInitiator = z.infer<typeof appUpdateCheckInitiatorSchema>;

export const appUpdateOperationValues = ["initialize", "check", "download", "install"] as const;
export const appUpdateOperationSchema = z.enum(appUpdateOperationValues);
export type AppUpdateOperation = z.infer<typeof appUpdateOperationSchema>;

export const appUpdateErrorCodeValues = [
  "not_packaged",
  "missing_update_config",
  "unsupported_linux_target",
  "updater_unavailable",
  "invalid_state",
  "busy",
  "check_failed",
  "download_failed",
  "install_failed",
] as const;
export const appUpdateErrorCodeSchema = z.enum(appUpdateErrorCodeValues);
export type AppUpdateErrorCode = z.infer<typeof appUpdateErrorCodeSchema>;

export const appUpdateErrorSchema = z
  .object({
    code: appUpdateErrorCodeSchema,
    message: z.string().trim().min(1),
    operation: appUpdateOperationSchema,
    causeName: z.string().trim().min(1).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type AppUpdateError = z.infer<typeof appUpdateErrorSchema>;

export const appUpdateStateSchema = z
  .object({
    status: appUpdateStatusSchema,
    currentVersion: z.string().trim().min(1),
    availableVersion: z.string().trim().min(1).optional(),
    progressPercent: z.number().min(0).max(100).optional(),
    checkInitiator: appUpdateCheckInitiatorSchema.optional(),
    checkedAt: z.string().datetime({ offset: true }).optional(),
    disabledCode: appUpdateErrorCodeSchema.optional(),
    disabledReason: z.string().trim().min(1).optional(),
    error: appUpdateErrorSchema.optional(),
  })
  .strict();
export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;

export const appUpdateCommandRejectionSchema = z
  .object({
    code: appUpdateErrorCodeSchema,
    message: z.string().trim().min(1),
    operation: appUpdateOperationSchema,
  })
  .strict();
export type AppUpdateCommandRejection = z.infer<typeof appUpdateCommandRejectionSchema>;

export const appUpdateCommandResultSchema = z.discriminatedUnion("accepted", [
  z
    .object({
      accepted: z.literal(true),
      state: appUpdateStateSchema,
    })
    .strict(),
  z
    .object({
      accepted: z.literal(false),
      rejection: appUpdateCommandRejectionSchema,
      state: appUpdateStateSchema,
    })
    .strict(),
]);
export type AppUpdateCommandResult = z.infer<typeof appUpdateCommandResultSchema>;

export const appUpdateStateChangedEventSchema = z
  .object({
    type: z.literal("state_changed"),
    state: appUpdateStateSchema,
  })
  .strict();
export type AppUpdateStateChangedEvent = z.infer<typeof appUpdateStateChangedEventSchema>;
