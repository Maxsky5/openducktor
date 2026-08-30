import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { agentUserMessageEventSchema } from "./agent-session-event-schemas";
import {
  agentModelSelectionSchema,
  agentSessionAssociationSchema,
  agentSessionLiveRefSchema,
  agentSessionScopeSchema,
} from "./agent-session-schemas";
import { skillDescriptorSchema } from "./skill-schemas";
import { slashCommandDescriptorSchema } from "./slash-command-schemas";
import { subagentDescriptorSchema } from "./subagent-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);

const agentSessionControlWorkingDirectoryFields = {
  repoPath: nonEmptyStringSchema,
  runtimeKind: runtimeKindSchema,
  workingDirectory: nonEmptyStringSchema,
};

const fileReferenceSchema = z
  .object({
    id: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    kind: z.enum(["directory", "css", "code", "image", "video", "default"]),
  })
  .strict();

const attachmentReferenceSchema = z
  .object({
    id: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    kind: z.enum(["image", "audio", "video", "pdf"]),
    mime: nonEmptyStringSchema.optional(),
  })
  .strict();

export const agentSessionUserMessagePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }).strict(),
  z
    .object({
      kind: z.literal("slash_command"),
      command: slashCommandDescriptorSchema.strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("file_reference"),
      file: fileReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("skill_mention"),
      skill: skillDescriptorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("subagent_reference"),
      subagent: subagentDescriptorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("attachment"),
      attachment: attachmentReferenceSchema,
    })
    .strict(),
]);
export type AgentSessionUserMessagePart = z.infer<typeof agentSessionUserMessagePartSchema>;

export const agentSessionControlStartInputSchema = z
  .object({
    ...agentSessionControlWorkingDirectoryFields,
    sessionScope: agentSessionScopeSchema,
    systemPrompt: z.string(),
    model: agentModelSelectionSchema.optional(),
  })
  .strict();
export type AgentSessionControlStartInput = z.infer<typeof agentSessionControlStartInputSchema>;

export const agentSessionControlResumeInputSchema = agentSessionLiveRefSchema
  .extend({
    sessionScope: agentSessionScopeSchema,
    model: agentModelSelectionSchema.optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();
export type AgentSessionControlResumeInput = z.infer<typeof agentSessionControlResumeInputSchema>;

export const agentSessionControlForkInputSchema = z
  .object({
    ...agentSessionControlWorkingDirectoryFields,
    sessionScope: agentSessionScopeSchema,
    systemPrompt: z.string(),
    model: agentModelSelectionSchema.optional(),
    parentExternalSessionId: nonEmptyStringSchema,
    runtimeHistoryAnchor: nonEmptyStringSchema.optional(),
  })
  .strict();
export type AgentSessionControlForkInput = z.infer<typeof agentSessionControlForkInputSchema>;

export const agentSessionControlSendInputSchema = agentSessionLiveRefSchema
  .extend({
    sessionScope: agentSessionScopeSchema,
    parts: z.array(agentSessionUserMessagePartSchema).min(1),
    model: agentModelSelectionSchema.optional(),
    systemPrompt: z.string().optional(),
  })
  .strict()
  .superRefine(({ parts }, ctx) => {
    const hasAttachment = parts.some((part) => part.kind === "attachment");
    const hasSlashCommand = parts.some((part) => part.kind === "slash_command");
    if (hasAttachment && hasSlashCommand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parts"],
        message: "Slash commands and attachments cannot be combined in one message.",
      });
    }
  });
export type AgentSessionControlSendInput = z.infer<typeof agentSessionControlSendInputSchema>;

export const agentSessionControlUpdateModelInputSchema = agentSessionLiveRefSchema
  .extend({
    model: agentModelSelectionSchema.nullable(),
  })
  .strict();
export type AgentSessionControlUpdateModelInput = z.infer<
  typeof agentSessionControlUpdateModelInputSchema
>;

export const agentSessionControlStopInputSchema = agentSessionLiveRefSchema;
export type AgentSessionControlStopInput = z.infer<typeof agentSessionControlStopInputSchema>;

export const agentSessionControlReleaseInputSchema = agentSessionLiveRefSchema;
export type AgentSessionControlReleaseInput = z.infer<typeof agentSessionControlReleaseInputSchema>;

export const agentSessionControlSummarySchema = z
  .object({
    externalSessionId: nonEmptyStringSchema,
    runtimeKind: runtimeKindSchema,
    workingDirectory: nonEmptyStringSchema,
    title: z.string().optional(),
    sessionAssociation: agentSessionAssociationSchema,
    startedAt: z.string().datetime({ offset: true }),
    status: z.enum(["starting", "running", "idle", "error", "stopped"]),
  })
  .strict();
export type AgentSessionControlSummary = z.infer<typeof agentSessionControlSummarySchema>;

export const acceptedAgentUserMessageSchema = agentUserMessageEventSchema;
export type AcceptedAgentUserMessage = z.infer<typeof acceptedAgentUserMessageSchema>;
