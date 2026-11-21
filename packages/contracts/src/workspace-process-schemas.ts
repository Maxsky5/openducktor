import { z } from "zod";

export const workspaceCheckoutOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    workspaceId: z.string(),
    taskId: z.string(),
    title: z.string(),
  }),
  z.object({
    kind: z.literal("workspace_session"),
    workspaceId: z.string(),
    sessionId: z.string(),
    title: z.string(),
  }),
]);
export type WorkspaceCheckoutOwner = z.infer<typeof workspaceCheckoutOwnerSchema>;

export const workspaceProcessIssueSchema = z.object({
  message: z.string().min(1),
  nextAction: z.string().min(1),
});
export type WorkspaceProcessIssue = z.infer<typeof workspaceProcessIssueSchema>;

export const workspaceProcessListenerSchema = z.object({
  address: z.string().min(1),
  port: z.number().int().min(0).max(65_535),
  browser: z.discriminatedUnion("kind", [
    /** `suggested` is true when the host does not know the protocol and suggests HTTP. */
    z.object({ kind: z.literal("link"), url: z.url(), suggested: z.boolean() }),
    z.object({ kind: z.literal("non_web") }),
    z.object({ kind: z.literal("unavailable"), issue: workspaceProcessIssueSchema }),
  ]),
});
export type WorkspaceProcessListener = z.infer<typeof workspaceProcessListenerSchema>;

export const workspaceProcessRowSchema = z.object({
  /** An opaque reference to one process instance. */
  processRef: z.string().min(1),
  pid: z.number().int().positive(),
  name: z.string().min(1),
  /** The command line, or the name when the host cannot read the arguments. */
  command: z.string().min(1),
  /** The nearest process of the same checkout in the list that started this process. */
  parentRef: z.string().min(1).optional(),
  /**
   * The app that started this process when neither a shell nor a listed process did, such as an
   * editor that starts its language servers.
   */
  launcher: z.string().min(1).optional(),
  /**
   * The working directory relative to the checkout, with `/` separators, and empty at the checkout
   * root. Absent when the process counts by its executable.
   */
  directory: z.string().optional(),
  stop: z.discriminatedUnion("allowed", [
    z.object({
      allowed: z.literal(true),
      requiresPidReuseAcknowledgment: z.boolean(),
      /** True when the system ends the process at once, without a request that it can handle. */
      forced: z.boolean(),
    }),
    z.object({ allowed: z.literal(false), issue: workspaceProcessIssueSchema }),
  ]),
  listeners: z.array(workspaceProcessListenerSchema),
  /** Present when the host could not verify every listener of the process. */
  listenerIssue: workspaceProcessIssueSchema.optional(),
});
export type WorkspaceProcessRow = z.infer<typeof workspaceProcessRowSchema>;

export const workspaceProcessGroupSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  checkoutPath: z.string().min(1),
  kind: z.enum(["repository", "worktree"]),
  owners: z.array(workspaceCheckoutOwnerSchema),
  processes: z.array(workspaceProcessRowSchema),
});
export type WorkspaceProcessGroup = z.infer<typeof workspaceProcessGroupSchema>;

/** The processes of the checkouts of all open workspaces. */
export const workspaceProcessListSchema = z.object({
  groups: z.array(workspaceProcessGroupSchema),
  /** Parts that the host could not read. An empty list means a complete read. */
  issues: z.array(workspaceProcessIssueSchema),
});
export type WorkspaceProcessList = z.infer<typeof workspaceProcessListSchema>;

export const workspaceProcessStopRequestSchema = z.object({
  workspaceId: z.string().trim().min(1),
  /** The exact checkout path from the list. A path can end with a space. */
  checkoutPath: z.string().min(1),
  /** The processes to stop together, such as a command and the processes that it started. */
  processRefs: z.array(z.string().min(1)).min(1),
  acknowledgedPidReuseRisk: z.literal(true).optional(),
});
export type WorkspaceProcessStopRequest = z.infer<typeof workspaceProcessStopRequestSchema>;

export const workspaceProcessStopResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stopped") }),
  z.object({ kind: z.literal("already_exited") }),
  z.object({ kind: z.literal("out_of_date"), issue: workspaceProcessIssueSchema }),
  z.object({ kind: z.literal("pending"), issue: workspaceProcessIssueSchema }),
  z.object({ kind: z.literal("still_running"), issue: workspaceProcessIssueSchema }),
  z.object({ kind: z.literal("unconfirmed"), issue: workspaceProcessIssueSchema }),
]);
export type WorkspaceProcessStopResult = z.infer<typeof workspaceProcessStopResultSchema>;

export const workspaceProcessStopResponseSchema = z.object({
  /** One result for each requested process, in the order of the request. */
  results: z.array(
    z.object({ processRef: z.string().min(1), result: workspaceProcessStopResultSchema }),
  ),
});
export type WorkspaceProcessStopResponse = z.infer<typeof workspaceProcessStopResponseSchema>;
