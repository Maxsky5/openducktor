import type { WorkflowRailStep } from "@openducktor/frontend-core/tasks/presentation/workflow-rail";
import { CircleUserRound } from "lucide-react";
import { roleIconForHint } from "@/lib/agent-role-presentation";
import type { AgentWorkflowStep } from "./agent-studio-header.types";

/** The desktop view of a shared workflow rail step, keyed by its session identity key. */
export const toAgentWorkflowStep = ({
  session,
  iconHint,
  ...step
}: WorkflowRailStep<string>): AgentWorkflowStep => ({
  ...step,
  human: step.role === null,
  icon: step.role === null ? CircleUserRound : roleIconForHint(iconHint),
  sessionValue: session,
});
