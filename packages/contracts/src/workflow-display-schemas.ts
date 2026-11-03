import { z } from "zod";

/** Semantic tones. Each client maps every tone to its own theme tokens. */
export const workflowToneSchema = z.enum([
  "neutral",
  "pending",
  "info",
  "warning",
  "destructive",
  "review",
  "approval",
  "success",
]);
export type WorkflowTone = z.infer<typeof workflowToneSchema>;

/** Semantic icons. Each client maps every icon to its own drawing. */
export const workflowIconSchema = z.enum([
  "specification",
  "planning",
  "building",
  "quality",
  "agent",
  "open",
  "reset",
  "complete",
  "undo",
  "remove_worktree",
  "feature",
  "bug",
  "task",
]);
export type WorkflowIcon = z.infer<typeof workflowIconSchema>;

/** The emphasis of an action control. */
export const workflowActionEmphasisSchema = z.enum([
  "prominent",
  "neutral",
  "destructive",
  "warning",
]);
export type WorkflowActionEmphasis = z.infer<typeof workflowActionEmphasisSchema>;

export const workflowActionSurfaceSchema = z.enum(["kanban", "details", "studio", "palette"]);
export type WorkflowActionSurface = z.infer<typeof workflowActionSurfaceSchema>;

export const workflowSessionActivitySchema = z.enum([
  "none",
  "starting",
  "running",
  "idle",
  "stopped",
  "error",
  "waiting_input",
]);
export type WorkflowSessionActivity = z.infer<typeof workflowSessionActivitySchema>;
