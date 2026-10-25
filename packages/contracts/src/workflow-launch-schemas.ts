import { z } from "zod";
import { agentSessionModelSelectionSchema } from "./session-schemas";
import { agentSessionLiveRefSchema } from "./agent-session-schemas";
import { sessionLaunchResultSchema } from "./session-launch-schemas";
import { agentRoleSchema, agentSessionStartModeSchema } from "./agent-workflow-schemas";
import { agentSessionControlSendInputSchema } from "./agent-session-control-schemas";
import { gitTargetBranchSchema } from "./git-schemas";
import { workflowIdSchema } from "./workflow-condition-schemas";

/** A launch action of the task workflow. */
export const sessionLaunchActionIdSchema = workflowIdSchema;

export const workflowLaunchDecisionSchema = z.discriminatedUnion("startMode", [
  z
    .object({
      startMode: z.literal("fresh"),
      selectedModel: agentSessionModelSelectionSchema,
      /**
       * The fresh session must start in this directory. The host accepts only the task worktree.
       */
      targetWorkingDirectory: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      startMode: z.literal("reuse"),
      sourceSession: agentSessionLiveRefSchema.omit({ repoPath: true }),
      // Omit to keep the source speed. Null sets standard speed.
      speed: z.string().min(1).nullable().optional(),
    })
    .strict(),
  z
    .object({
      startMode: z.literal("fork"),
      selectedModel: agentSessionModelSelectionSchema,
      sourceSession: agentSessionLiveRefSchema.omit({ repoPath: true }),
    })
    .strict(),
]);
/** Clients launch only manual decisions. Only the host creates automatic Autopilot launches. */
export const workflowLaunchRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    repoPath: z.string().min(1),
    taskId: z.string().min(1),
    policy: z
      .object({
        kind: z.literal("manual"),
        actionId: sessionLaunchActionIdSchema,
        decision: workflowLaunchDecisionSchema,
      })
      .strict(),
    instruction: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z
        .object({
          kind: z.literal("kickoff"),
          text: z.string().optional(),
          feedback: z.string().optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("message"),
          parts: agentSessionControlSendInputSchema.shape.parts,
        })
        .strict(),
    ]),
    targetBranch: gitTargetBranchSchema.optional(),
    beforeStartAction: z
      .object({ action: z.literal("human_request_changes"), note: z.string() })
      .strict()
      .optional(),
  })
  .strict();
export type WorkflowLaunchRequest = z.infer<typeof workflowLaunchRequestSchema>;
export type WorkflowLaunchDecision = z.infer<typeof workflowLaunchDecisionSchema>;
export const workflowLaunchResultSchema = sessionLaunchResultSchema.extend({
  taskId: z.string(),
  role: agentRoleSchema,
  /** The start mode that the host chose. It is absent when the launch ended before that choice. */
  startMode: agentSessionStartModeSchema.optional(),
});
export type WorkflowLaunchResult = z.infer<typeof workflowLaunchResultSchema>;
