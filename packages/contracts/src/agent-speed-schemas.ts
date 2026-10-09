import { z } from "zod";

export const agentSpeedLevelSchema = z.strictObject({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().optional(),
});
export type AgentSpeedLevel = z.infer<typeof agentSpeedLevelSchema>;

export const runtimeSpeedCapabilitySchema = z.strictObject({
  support: z.enum(["none", "model", "runtime"]),
  levels: z.array(agentSpeedLevelSchema).optional(),
});
export type RuntimeSpeedCapability = z.infer<typeof runtimeSpeedCapabilitySchema>;

export const agentSpeedReasonSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  nextAction: z.string().min(1).optional(),
});
export type AgentSpeedReason = z.infer<typeof agentSpeedReasonSchema>;

export const agentSpeedAvailabilitySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available") }),
  z.strictObject({ status: z.literal("blocked"), reason: agentSpeedReasonSchema }),
  z.strictObject({ status: z.literal("unknown"), reason: agentSpeedReasonSchema.optional() }),
]);
export type AgentSpeedAvailability = z.infer<typeof agentSpeedAvailabilitySchema>;

export const agentSpeedProcessingSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.enum(["unknown", "off"]) }),
  z.strictObject({ status: z.literal("active"), level: z.string().min(1) }),
  z.strictObject({
    status: z.enum(["cooldown", "standard"]),
    reason: agentSpeedReasonSchema.optional(),
  }),
]);
export type AgentSpeedProcessing = z.infer<typeof agentSpeedProcessingSchema>;

export const agentSessionSpeedStateSchema = z.strictObject({
  choice: z.string().min(1).nullable(),
  synchronization: z.enum(["confirmed", "pending", "unapplied", "uncertain"]),
  availability: agentSpeedAvailabilitySchema,
  processing: agentSpeedProcessingSchema,
  reason: agentSpeedReasonSchema.optional(),
});
export type AgentSessionSpeedState = z.infer<typeof agentSessionSpeedStateSchema>;

export const agentSpeedRuntimeObservationSchema = z.strictObject({
  reportedChoice: z.string().min(1).optional(),
  availability: agentSpeedAvailabilitySchema.optional(),
  processing: agentSpeedProcessingSchema.optional(),
});
export type AgentSpeedRuntimeObservation = z.infer<typeof agentSpeedRuntimeObservationSchema>;
