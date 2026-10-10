import { z } from "zod";

/** A speed above standard. A model selection without `speed` uses standard speed. */
export const agentSpeedLevelSchema = z.strictObject({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().optional(),
});
export type AgentSpeedLevel = z.infer<typeof agentSpeedLevelSchema>;

export const runtimeSpeedCapabilitySchema = z.strictObject({
  support: z.enum(["none", "model"]),
});
export type RuntimeSpeedCapability = z.infer<typeof runtimeSpeedCapabilitySchema>;

export const agentSpeedAvailabilitySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available") }),
  z.strictObject({
    status: z.literal("blocked"),
    reason: z.strictObject({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);
export type AgentSpeedAvailability = z.infer<typeof agentSpeedAvailabilitySchema>;
