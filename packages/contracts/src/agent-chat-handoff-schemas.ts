import { z } from "zod";
import { agentSessionLiveRefSchema, agentModelSelectionSchema } from "./agent-session-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { workspaceRefSchema } from "./workspace-id-schemas";

const id = z.string().trim().min(1);
export const handoffNativeSessionSchema = agentSessionLiveRefSchema.omit({ repoPath: true });
export type HandoffNativeSession = z.infer<typeof handoffNativeSessionSchema>;

export const agentChatRefSchema = z.discriminatedUnion("kind", [
  workspaceRefSchema.extend({ kind: z.literal("workspace_session"), sessionId: id }),
  workspaceRefSchema.extend({
    kind: z.literal("task_session"),
    taskId: id,
    role: agentRoleSchema,
    first: handoffNativeSessionSchema,
  }),
]);
export type AgentChatRef = z.infer<typeof agentChatRefSchema>;

export const handoffTargetSchema = z.strictObject({
  chat: agentChatRefSchema,
  expectedActive: handoffNativeSessionSchema,
  destination: agentModelSelectionSchema.extend({ runtimeKind: runtimeKindSchema }),
  submissionId: id,
});
export type HandoffTarget = z.infer<typeof handoffTargetSchema>;

export const handoffLinkSchema = z.strictObject({
  from: handoffNativeSessionSchema,
  to: handoffNativeSessionSchema,
  firstMessageId: id,
  partialHistory: z.boolean(),
});
export type HandoffLink = z.infer<typeof handoffLinkSchema>;

export const chatHandoffReadSchema = z.strictObject({ links: z.array(handoffLinkSchema) });
export type ChatHandoffRead = z.infer<typeof chatHandoffReadSchema>;

export const handoffContextPrefixSchema = z.strictObject({
  version: z.literal(1),
  utf8Bytes: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type HandoffContextPrefix = z.infer<typeof handoffContextPrefixSchema>;

/** Prepared by the host and passed only to the native send implementation. */
export type NativeHandoffInput = { admissionId: string; historyPrefix: string | null };
