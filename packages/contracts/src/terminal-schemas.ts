import { z } from "zod";

export const TERMINAL_ID_MAX_LENGTH = 128;
export const terminalIdSchema = z.string().trim().min(1).max(TERMINAL_ID_MAX_LENGTH);
export const terminalTaskIdSchema = z.string().trim().min(1);

export const terminalContextSchema = z
  .object({
    taskId: terminalTaskIdSchema.optional(),
  })
  .strict();
export type TerminalContext = z.infer<typeof terminalContextSchema>;

export const terminalLaunchSpecSchema = z
  .object({
    workingDir: z.string().trim().min(1),
    context: terminalContextSchema,
  })
  .strict();
export type TerminalLaunchSpec = z.infer<typeof terminalLaunchSpecSchema>;

export const terminalRefSchema = z.object({ terminalId: terminalIdSchema }).strict();
export type TerminalRef = z.infer<typeof terminalRefSchema>;

export const terminalLifecycleSchema = z.enum([
  "starting",
  "running",
  "exited",
  "closing",
  "close_failed",
]);
export type TerminalLifecycle = z.infer<typeof terminalLifecycleSchema>;

export const terminalExitSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
    finalSequence: z.number().int().nonnegative(),
    exitedAt: z.string().min(1),
  })
  .strict();
export type TerminalExit = z.infer<typeof terminalExitSchema>;

export const terminalSummarySchema = z
  .object({
    terminalId: terminalIdSchema,
    label: z.string().min(1),
    context: terminalContextSchema,
    initialWorkingDir: z.string().min(1),
    createdAt: z.string().min(1),
    lifecycle: terminalLifecycleSchema,
    exit: terminalExitSchema.nullable(),
  })
  .strict();
export type TerminalSummary = z.infer<typeof terminalSummarySchema>;

export const terminalFailureCodeSchema = z.enum([
  "invalid_working_directory",
  "working_directory_not_found",
  "working_directory_inaccessible",
  "working_directory_not_directory",
  "task_worktree_unavailable",
  "shell_unavailable",
  "unsupported_shell",
  "unsupported_runtime",
  "spawn_failed",
  "terminal_not_found",
  "terminal_forgotten",
  "host_terminal_limit",
  "context_terminal_limit",
  "invalid_input",
  "invalid_grid",
  "confirmation_required",
  "output_overflow",
  "close_failed",
  "authentication_failed",
  "invalid_origin",
  "protocol_error",
  "unsupported_protocol_version",
  "message_too_large",
  "outbound_queue_overflow",
]);
export type TerminalFailureCode = z.infer<typeof terminalFailureCodeSchema>;

export const terminalFailureSchema = z
  .object({
    code: terminalFailureCodeSchema,
    message: z.string().min(1),
    terminalId: terminalIdSchema.optional(),
    workingDir: z.string().min(1).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type TerminalFailure = z.infer<typeof terminalFailureSchema>;

export const hostInvokeFailureSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("terminal"),
      terminalFailure: terminalFailureSchema,
    })
    .strict(),
]);
export type HostInvokeFailure = z.infer<typeof hostInvokeFailureSchema>;

export const terminalCreateRequestSchema = terminalLaunchSpecSchema;
export type TerminalCreateRequest = z.infer<typeof terminalCreateRequestSchema>;

export const terminalCreateResponseSchema = z
  .object({
    ref: terminalRefSchema,
    summary: terminalSummarySchema,
  })
  .strict();
export type TerminalCreateResponse = z.infer<typeof terminalCreateResponseSchema>;

export const terminalListFilterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("task"), taskId: terminalTaskIdSchema }).strict(),
  z.object({ kind: z.literal("unassociated") }).strict(),
]);
export type TerminalListFilter = z.infer<typeof terminalListFilterSchema>;

export const terminalListRequestSchema = z.object({ filter: terminalListFilterSchema }).strict();
export type TerminalListRequest = z.infer<typeof terminalListRequestSchema>;

export const terminalListResponseSchema = z
  .object({
    hostInstanceId: z.string().min(1),
    terminals: z.array(terminalSummarySchema),
  })
  .strict();
export type TerminalListResponse = z.infer<typeof terminalListResponseSchema>;

export const terminalPreparePathInputRequestSchema = z
  .object({
    terminalId: terminalIdSchema,
    paths: z.array(z.string().min(1).max(32_768)).min(1).max(8),
  })
  .strict();
export type TerminalPreparePathInputRequest = z.infer<typeof terminalPreparePathInputRequestSchema>;

export const terminalPreparePathInputResponseSchema = z
  .object({ text: z.string().min(1).max(262_144) })
  .strict();
export type TerminalPreparePathInputResponse = z.infer<
  typeof terminalPreparePathInputResponseSchema
>;

export const terminalCloseRequestSchema = z
  .object({
    terminalId: terminalIdSchema,
    confirmTerminate: z.boolean(),
  })
  .strict();
export type TerminalCloseRequest = z.infer<typeof terminalCloseRequestSchema>;

export const terminalCloseResponseSchema = z.discriminatedUnion("closed", [
  z.object({ closed: z.literal(true) }).strict(),
  z.object({ closed: z.literal(false), confirmationRequired: z.literal(true) }).strict(),
]);
export type TerminalCloseResponse = z.infer<typeof terminalCloseResponseSchema>;
