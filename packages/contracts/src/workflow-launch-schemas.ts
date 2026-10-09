import { z } from "zod";
import { agentSessionModelSelectionSchema, agentSessionRecordSchema } from "./session-schemas";
import { agentSessionLiveRefSchema } from "./agent-session-schemas";
import { sessionLaunchStateSchema } from "./session-launch-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";
import { agentSessionControlSendInputSchema } from "./agent-session-control-schemas";
import { gitTargetBranchSchema } from "./git-schemas";
import { AUTOPILOT_ACTION_IDS } from "./config-schemas";

export const sessionLaunchActionIds = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "build_pull_request_generation",
  "build_rebase_conflict_resolution",
  "qa_review",
] as const;

export type SessionLaunchActionId = (typeof sessionLaunchActionIds)[number];

export const workflowLaunchDecisionSchema = z.discriminatedUnion("startMode", [
  z
    .object({
      startMode: z.literal("fresh"),
      selectedModel: agentSessionModelSelectionSchema,
      speed: agentSessionRecordSchema.shape.speed,
    })
    .strict(),
  z
    .object({
      startMode: z.literal("reuse"),
      sourceSession: agentSessionLiveRefSchema.omit({ repoPath: true }),
      speed: agentSessionRecordSchema.shape.speed,
    })
    .strict(),
  z
    .object({
      startMode: z.literal("fork"),
      selectedModel: agentSessionModelSelectionSchema,
      sourceSession: agentSessionLiveRefSchema.omit({ repoPath: true }),
      speed: agentSessionRecordSchema.shape.speed,
    })
    .strict(),
]);
export const workflowLaunchRequestSchema = z
  .object({
    launchAttemptId: z.string().min(1),
    workspaceId: z.string().min(1),
    repoPath: z.string().min(1),
    taskId: z.string().min(1),
    policy: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("manual"),
          actionId: z.enum(sessionLaunchActionIds),
          decision: workflowLaunchDecisionSchema,
        })
        .strict(),
      z.object({ kind: z.literal("automatic"), actionId: z.enum(AUTOPILOT_ACTION_IDS) }).strict(),
    ]),
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
    targetWorkingDirectory: z.string().min(1).optional(),
    beforeStartAction: z
      .object({ action: z.literal("human_request_changes"), note: z.string() })
      .strict()
      .optional(),
    queueIfBusy: z.boolean().optional(),
  })
  .strict();
export type WorkflowLaunchRequest = z.infer<typeof workflowLaunchRequestSchema>;
export type WorkflowLaunchDecision = z.infer<typeof workflowLaunchDecisionSchema>;
export const workflowLaunchRefSchema = workflowLaunchRequestSchema.pick({
  workspaceId: true,
  repoPath: true,
  taskId: true,
  launchAttemptId: true,
});
export type WorkflowLaunchRef = z.infer<typeof workflowLaunchRefSchema>;
export const workflowLaunchReadSchema = workflowLaunchRefSchema.extend({
  launchAttemptId: z.string().min(1).optional(),
});
export type WorkflowLaunchRead = z.infer<typeof workflowLaunchReadSchema>;
export const workflowLaunchSnapshotSchema = sessionLaunchStateSchema.extend({
  taskId: z.string(),
  role: agentRoleSchema,
  completedPreStartActions: z.array(z.enum(["human_request_changes", "target_branch"])),
});
export type WorkflowLaunchSnapshot = z.infer<typeof workflowLaunchSnapshotSchema>;
