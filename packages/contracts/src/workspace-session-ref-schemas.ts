import { z } from "zod";
import { workspaceIdSchema } from "./workspace-id-schemas";

export const workspaceSessionListInputSchema = z.strictObject({ workspaceId: workspaceIdSchema });
export const workspaceSessionRefInputSchema = workspaceSessionListInputSchema.extend({
  sessionId: z.string().min(1),
});
export type WorkspaceSessionRefInput = z.infer<typeof workspaceSessionRefInputSchema>;
