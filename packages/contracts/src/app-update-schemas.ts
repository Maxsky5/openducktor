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

export const appUpdateCheckInputSchema = z
  .object({
    initiator: z.enum(["settings", "menu"]),
  })
  .strict();
export type AppUpdateCheckInput = z.infer<typeof appUpdateCheckInputSchema>;

export const appUpdateOperationValues = ["initialize", "check", "download", "install"] as const;
export const appUpdateOperationSchema = z.enum(appUpdateOperationValues);
export type AppUpdateOperation = z.infer<typeof appUpdateOperationSchema>;

export const appUpdateErrorCodeValues = [
  "not_packaged",
  "unsupported_web_runner",
  "missing_update_config",
  "unsupported_linux_target",
  "updater_unavailable",
  "invalid_state",
  "busy",
  "check_failed",
  "download_failed",
  "install_failed",
  "incompatible_app_signature",
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

const appUpdateVersionSchema = z.string().trim().min(1);
const appUpdateCheckedAtSchema = z.string().datetime({ offset: true });
const appUpdateProgressPercentSchema = z.number().min(0).max(100);

export const appUpdateStateSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("disabled"),
      currentVersion: appUpdateVersionSchema,
      checkInitiator: appUpdateCheckInitiatorSchema.optional(),
      checkedAt: appUpdateCheckedAtSchema.optional(),
      disabledCode: appUpdateErrorCodeSchema,
      disabledReason: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("idle"),
      currentVersion: appUpdateVersionSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("checking"),
      currentVersion: appUpdateVersionSchema,
      availableVersion: appUpdateVersionSchema.optional(),
      checkInitiator: appUpdateCheckInitiatorSchema,
      checkedAt: appUpdateCheckedAtSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("upToDate"),
      currentVersion: appUpdateVersionSchema,
      checkInitiator: appUpdateCheckInitiatorSchema.optional(),
      checkedAt: appUpdateCheckedAtSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("available"),
      currentVersion: appUpdateVersionSchema,
      availableVersion: appUpdateVersionSchema,
      checkInitiator: appUpdateCheckInitiatorSchema.optional(),
      checkedAt: appUpdateCheckedAtSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("downloading"),
      currentVersion: appUpdateVersionSchema,
      availableVersion: appUpdateVersionSchema,
      progressPercent: appUpdateProgressPercentSchema,
      checkInitiator: appUpdateCheckInitiatorSchema.optional(),
      checkedAt: appUpdateCheckedAtSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("downloaded"),
      currentVersion: appUpdateVersionSchema,
      availableVersion: appUpdateVersionSchema,
      progressPercent: appUpdateProgressPercentSchema,
      checkInitiator: appUpdateCheckInitiatorSchema.optional(),
      checkedAt: appUpdateCheckedAtSchema.optional(),
      installRequested: z.literal(true).optional(),
      installRetryDisabled: z.literal(true).optional(),
      error: appUpdateErrorSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("error"),
      currentVersion: appUpdateVersionSchema,
      availableVersion: appUpdateVersionSchema.optional(),
      checkInitiator: appUpdateCheckInitiatorSchema.optional(),
      checkedAt: appUpdateCheckedAtSchema.optional(),
      error: appUpdateErrorSchema,
    })
    .strict(),
]);
export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;
export type AppUpdateDownloadableState =
  | Extract<AppUpdateState, { status: "available" }>
  | (Extract<AppUpdateState, { status: "error" }> & { availableVersion: string });
type AppUpdateDownloadedState = Extract<AppUpdateState, { status: "downloaded" }>;
export type AppUpdateInstallableState = AppUpdateDownloadedState & {
  installRequested?: undefined;
  installRetryDisabled?: undefined;
};

export const canDownloadAppUpdate = (
  state: AppUpdateState,
): state is AppUpdateDownloadableState => {
  if (state.status === "available") {
    return true;
  }
  return (
    state.status === "error" &&
    Boolean(state.availableVersion) &&
    (state.error.operation === "check" || state.error.operation === "download")
  );
};

export const canInstallAppUpdate = (state: AppUpdateState): state is AppUpdateInstallableState =>
  state.status === "downloaded" &&
  state.installRequested !== true &&
  state.installRetryDisabled !== true;

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
