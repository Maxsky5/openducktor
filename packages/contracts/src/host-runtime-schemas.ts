import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { agentSessionLiveRefSchema } from "./agent-session-schemas";
import { agentSessionActivitySchema } from "./agent-session-live-schemas";
import { workspaceRecordSchema } from "./git-schemas";
import { isoTimestampSchema } from "./string-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);

export const hostRuntimeLifecycleStateSchema = z.enum([
  "disabled",
  "starting",
  "ready",
  "restarting",
  "stopping",
  "error",
]);
export type HostRuntimeLifecycleState = z.infer<typeof hostRuntimeLifecycleStateSchema>;

export const hostRuntimeLifecycleTriggerSchema = z.enum([
  "host_startup",
  "restart",
  "settings",
  "crash",
  "shutdown",
]);
export type HostRuntimeLifecycleTrigger = z.infer<typeof hostRuntimeLifecycleTriggerSchema>;

export const hostRuntimeFailurePhaseSchema = z.enum(["configuration", "start", "run", "stop"]);
export type HostRuntimeFailurePhase = z.infer<typeof hostRuntimeFailurePhaseSchema>;

export const hostRuntimeFailureSchema = z
  .object({
    trigger: hostRuntimeLifecycleTriggerSchema,
    phase: hostRuntimeFailurePhaseSchema,
    message: nonEmptyStringSchema,
    nextAction: nonEmptyStringSchema,
    occurredAt: isoTimestampSchema,
  })
  .strict();
export type HostRuntimeFailure = z.infer<typeof hostRuntimeFailureSchema>;

/** Current state of the one shared runtime of a kind in this host. */
export const hostRuntimeStatusSchema = z
  .object({
    kind: runtimeKindSchema,
    enabled: z.boolean(),
    configuredExecutablePath: z.string(),
    effectiveExecutablePath: z.string().nullable(),
    version: z.string().nullable(),
    state: hostRuntimeLifecycleStateSchema,
    trigger: hostRuntimeLifecycleTriggerSchema.nullable(),
    runtimeId: z.string().nullable(),
    startedAt: isoTimestampSchema.nullable(),
    updatedAt: isoTimestampSchema,
    failure: hostRuntimeFailureSchema.nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type HostRuntimeStatus = z.infer<typeof hostRuntimeStatusSchema>;

export const hostRuntimeSnapshotSchema = z
  .object({
    hostInstanceId: nonEmptyStringSchema,
    runtimes: z.array(hostRuntimeStatusSchema),
  })
  .strict();
export type HostRuntimeSnapshot = z.infer<typeof hostRuntimeSnapshotSchema>;

export const hostRuntimeChangedEventSchema = z
  .object({
    type: z.literal("runtime_changed"),
    hostInstanceId: nonEmptyStringSchema,
    status: hostRuntimeStatusSchema,
  })
  .strict();
export type HostRuntimeChangedEvent = z.infer<typeof hostRuntimeChangedEventSchema>;

/** Live sessions of these kinds changed. An open restart or settings review reads its impact again. */
export const hostRuntimeImpactChangedEventSchema = z
  .object({
    type: z.literal("runtime_impact_changed"),
    runtimeKinds: z.array(runtimeKindSchema).min(1),
  })
  .strict();
export type HostRuntimeImpactChangedEvent = z.infer<typeof hostRuntimeImpactChangedEventSchema>;

export const hostRuntimeEventSchema = z.discriminatedUnion("type", [
  hostRuntimeChangedEventSchema,
  hostRuntimeImpactChangedEventSchema,
]);
export type HostRuntimeEvent = z.infer<typeof hostRuntimeEventSchema>;

export const runtimeLifecycleEffectSchema = z.enum(["restart", "start", "stop", "replace"]);
export type RuntimeLifecycleEffect = z.infer<typeof runtimeLifecycleEffectSchema>;

export const runtimeLifecycleKindImpactSchema = z
  .object({
    kind: runtimeKindSchema,
    runtimeId: z.string().nullable(),
    effect: runtimeLifecycleEffectSchema,
    oldExecutablePath: z.string().nullable(),
    newExecutablePath: z.string().nullable(),
  })
  .strict();
export type RuntimeLifecycleKindImpact = z.infer<typeof runtimeLifecycleKindImpactSchema>;

export const runtimeLifecycleSessionImpactSchema = z
  .object({
    ref: agentSessionLiveRefSchema,
    title: nonEmptyStringSchema,
    activity: agentSessionActivitySchema,
    pendingInputCount: z.number().int().nonnegative(),
    executionEpisodeId: nonEmptyStringSchema.optional(),
    parentExternalSessionId: nonEmptyStringSchema.optional(),
  })
  .strict();
export type RuntimeLifecycleSessionImpact = z.infer<typeof runtimeLifecycleSessionImpactSchema>;

export const runtimeLifecycleWorkspaceImpactSchema = z
  .object({
    workspaceId: z.string().nullable(),
    workspaceName: z.string().nullable(),
    repoPath: nonEmptyStringSchema,
    sessions: z.array(runtimeLifecycleSessionImpactSchema),
  })
  .strict();
export type RuntimeLifecycleWorkspaceImpact = z.infer<typeof runtimeLifecycleWorkspaceImpactSchema>;

/** Live work that a lifecycle action stops. `confirmation` binds a later action to this review. */
export const runtimeLifecycleImpactSchema = z
  .object({
    kinds: z.array(runtimeLifecycleKindImpactSchema),
    workspaces: z.array(runtimeLifecycleWorkspaceImpactSchema),
    confirmation: nonEmptyStringSchema,
  })
  .strict();
export type RuntimeLifecycleImpact = z.infer<typeof runtimeLifecycleImpactSchema>;

export const runtimeKindInputSchema = z.object({ runtimeKind: runtimeKindSchema }).strict();
export type RuntimeKindInput = z.infer<typeof runtimeKindInputSchema>;

export const runtimeRestartInputSchema = z
  .object({ runtimeKind: runtimeKindSchema, confirmation: nonEmptyStringSchema })
  .strict();
export type RuntimeRestartInput = z.infer<typeof runtimeRestartInputSchema>;

export const runtimeRestartResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("completed"), status: hostRuntimeStatusSchema }).strict(),
  z.object({ type: z.literal("failed"), status: hostRuntimeStatusSchema }).strict(),
  z.object({ type: z.literal("impact_changed"), impact: runtimeLifecycleImpactSchema }).strict(),
]);
export type RuntimeRestartResult = z.infer<typeof runtimeRestartResultSchema>;

/** `impact` is null when the save changes no runtime lifecycle. */
export const settingsSnapshotRuntimePreviewSchema = z
  .object({ impact: runtimeLifecycleImpactSchema.nullable() })
  .strict();
export type SettingsSnapshotRuntimePreview = z.infer<typeof settingsSnapshotRuntimePreviewSchema>;

export const runtimeSettingsApplicationSchema = z
  .object({
    kind: runtimeKindSchema,
    effect: runtimeLifecycleEffectSchema,
    outcome: z.enum(["applied", "failed"]),
    message: z.string().nullable(),
  })
  .strict();
export type RuntimeSettingsApplication = z.infer<typeof runtimeSettingsApplicationSchema>;

export const settingsSnapshotSaveResultSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("saved"),
      workspaces: z.array(workspaceRecordSchema),
      runtimeApplications: z.array(runtimeSettingsApplicationSchema),
    })
    .strict(),
  z
    .object({ type: z.literal("runtime_impact_changed"), impact: runtimeLifecycleImpactSchema })
    .strict(),
]);
export type SettingsSnapshotSaveResult = z.infer<typeof settingsSnapshotSaveResultSchema>;

export const hostMcpBridgeCheckSchema = z
  .object({
    state: z.enum(["ready", "error"]),
    hostUrl: z.string().nullable(),
    checkedAt: isoTimestampSchema,
    detail: z.string().nullable(),
  })
  .strict();
export type HostMcpBridgeCheck = z.infer<typeof hostMcpBridgeCheckSchema>;

export const workspaceRuntimeMcpObservationSchema = z
  .object({
    workingDirectory: nonEmptyStringSchema,
    state: z.enum(["connected", "failed"]),
    serverStatus: z.string().nullable(),
    toolIds: z.array(z.string()),
    detail: z.string().nullable(),
  })
  .strict();
export type WorkspaceRuntimeMcpObservation = z.infer<typeof workspaceRuntimeMcpObservationSchema>;

export const workspaceRuntimeMcpStatusSchema = z
  .object({
    kind: runtimeKindSchema,
    state: z.enum(["not_checked", "unavailable", "unsupported", "observed"]),
    runtimeId: z.string().nullable(),
    observations: z.array(workspaceRuntimeMcpObservationSchema),
    detail: z.string().nullable(),
  })
  .strict();
export type WorkspaceRuntimeMcpStatus = z.infer<typeof workspaceRuntimeMcpStatusSchema>;

export const workspaceRuntimeMcpCheckInputSchema = z
  .object({ repoPath: nonEmptyStringSchema })
  .strict();
export type WorkspaceRuntimeMcpCheckInput = z.infer<typeof workspaceRuntimeMcpCheckInputSchema>;

export const workspaceRuntimeMcpCheckSchema = z
  .object({
    repoPath: nonEmptyStringSchema,
    checkedAt: isoTimestampSchema,
    runtimes: z.array(workspaceRuntimeMcpStatusSchema),
  })
  .strict();
export type WorkspaceRuntimeMcpCheck = z.infer<typeof workspaceRuntimeMcpCheckSchema>;
