import type { AgentWorkflowStepTone } from "@/types/agent-workflow";

/** Shared label colors for workflow roles in the header and session navigation. */
export const AGENT_WORKFLOW_TONE_TEXT_CLASSES = {
  in_progress: "text-info-muted",
  done: "text-success-muted",
  available: "text-foreground",
  optional: "text-foreground",
  rejected: "text-rejected-muted",
  waiting_input: "text-warning-muted",
  failed: "text-destructive-muted",
  blocked: "text-secondary-foreground",
} satisfies Record<AgentWorkflowStepTone, string>;

/** Icons keep the workflow tone with a lighter success color than small text. */
export const AGENT_WORKFLOW_TONE_ICON_CLASSES = {
  ...AGENT_WORKFLOW_TONE_TEXT_CLASSES,
  done: "text-success-icon",
  blocked: "text-muted-foreground",
} satisfies Record<AgentWorkflowStepTone, string>;
