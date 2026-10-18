import { z } from "zod";

export const repoPullRequestSyncRequestSchema = z.object({
  repoPath: z.string().trim().min(1),
  expectedWorkspaceId: z.string().trim().min(1).optional(),
});
export type RepoPullRequestSyncRequest = z.infer<typeof repoPullRequestSyncRequestSchema>;

export const repoPullRequestSyncSkipReasonSchema = z.enum([
  "not_configured",
  "disabled",
  "workspace_closed",
  "workspace_unavailable",
]);
export type RepoPullRequestSyncSkipReason = z.infer<typeof repoPullRequestSyncSkipReasonSchema>;

export const repoPullRequestSyncResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: repoPullRequestSyncSkipReasonSchema,
    message: z.string().trim().min(1),
  }),
]);
export type RepoPullRequestSyncResponse = z.infer<typeof repoPullRequestSyncResponseSchema>;
