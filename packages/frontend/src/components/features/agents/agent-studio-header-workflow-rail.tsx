import type { AgentRole } from "@openducktor/core";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDotDashed,
  LoaderCircle,
} from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { isAgentSessionActivityWorking } from "@/lib/agent-session-activity-state";
import {
  AGENT_WORKFLOW_TONE_ICON_CLASSES,
  AGENT_WORKFLOW_TONE_TEXT_CLASSES,
} from "@/lib/agent-workflow-styles";
import { cn } from "@/lib/utils";
import type { AgentWorkflowStepState } from "@/types/agent-workflow";
import type { AgentWorkflowStep } from "./agent-studio-header.types";

type WorkflowRailProps = {
  steps: AgentWorkflowStep[];
  selectedRole: AgentRole | null;
  agentStudioReady: boolean;
  onStepSelect: (role: AgentRole, sessionValue: string | null) => void;
};

type WorkflowStepAttentionVariant = "none" | "session_waiting_input" | "blocked_task";

const WORKFLOW_STEP_CLASSES = {
  in_progress: "border-info-border bg-info-surface hover:bg-info-surface shadow-sm",
  done: "border-success-border bg-success-surface hover:bg-success-surface shadow-sm",
  available: "border-input bg-card",
  optional: "border-input bg-card",
  rejected: "border-rejected-border bg-rejected-surface shadow-sm hover:bg-rejected-surface",
  waiting_input: "border-warning-border bg-warning-surface hover:bg-warning-surface shadow-sm",
  failed: "border-destructive-border bg-destructive-surface hover:bg-destructive-surface shadow-sm",
  blocked: "border-border bg-muted",
} satisfies Record<AgentWorkflowStepState["tone"], string>;

const WORKFLOW_CONNECTOR_CLASSES = {
  done: "text-success-ring",
  in_progress: "text-info-ring",
  available: "text-muted-foreground/40",
  optional: "text-muted-foreground/40",
  rejected: "text-rejected-ring",
  waiting_input: "text-warning-ring",
  failed: "text-destructive-ring",
  blocked: "text-muted-foreground/20",
} satisfies Record<AgentWorkflowStepState["tone"], string>;

const WORKFLOW_SELECTION_CLASSES = {
  done: "ring-2 ring-offset-2 ring-offset-card ring-success-ring",
  in_progress: "ring-2 ring-offset-2 ring-offset-card ring-info-ring",
  available: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  optional: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  rejected: "ring-2 ring-offset-2 ring-offset-card ring-rejected-ring",
  waiting_input: "ring-2 ring-offset-2 ring-offset-card ring-warning-ring",
  failed: "ring-2 ring-offset-2 ring-offset-card ring-destructive-ring",
  blocked: "ring-2 ring-offset-2 ring-offset-card ring-warning-ring",
} satisfies Record<AgentWorkflowStepState["tone"], string>;

const requireWorkflowToneClass = (
  classes: Record<AgentWorkflowStepState["tone"], string>,
  tone: AgentWorkflowStepState["tone"],
  context: string,
): string => {
  const className = classes[tone];
  if (!className) {
    throw new Error(`Unknown workflow tone for ${context}: ${tone}`);
  }
  return className;
};

const workflowStepClassName = (state: AgentWorkflowStepState): string =>
  requireWorkflowToneClass(WORKFLOW_STEP_CLASSES, state.tone, "workflow step");

const workflowConnectorClassName = (state: AgentWorkflowStepState): string =>
  requireWorkflowToneClass(WORKFLOW_CONNECTOR_CLASSES, state.tone, "workflow connector");

const workflowSelectionClassName = (isSelected: boolean, state: AgentWorkflowStepState): string => {
  if (!isSelected) {
    return "";
  }
  return requireWorkflowToneClass(WORKFLOW_SELECTION_CLASSES, state.tone, "workflow selection");
};

const workflowBorderStyleClassName = (state: AgentWorkflowStepState): string =>
  // Dashed styling is only for steps that are currently merely optional and available.
  state.tone === "optional" ? "border-dashed" : "";

const getWorkflowStepAttentionVariant = (
  entry: AgentWorkflowStep,
): WorkflowStepAttentionVariant => {
  if (entry.state.liveSession === "waiting_input") {
    return "session_waiting_input";
  }

  if (entry.role === "build" && entry.state.tone === "waiting_input") {
    return "blocked_task";
  }

  return "none";
};

const workflowStepHint = (entry: AgentWorkflowStep): string => {
  const attentionVariant = getWorkflowStepAttentionVariant(entry);

  if (attentionVariant === "session_waiting_input") {
    return "Session is waiting for input";
  }
  if (attentionVariant === "blocked_task") {
    return "Task is blocked and waiting for user action";
  }
  if (
    entry.state.liveSession !== "none" &&
    isAgentSessionActivityWorking(entry.state.liveSession)
  ) {
    return "Step in progress";
  }
  if (entry.state.liveSession === "error") {
    return "Latest session failed";
  }
  if (entry.state.tone === "failed") {
    if (entry.sessionValue) {
      return "Open latest failed session for this role";
    }
    return "Step failed before a session could start";
  }
  if (entry.state.completion === "rejected") {
    return "Latest review rejected this task";
  }
  if (entry.sessionValue) {
    return "Open latest relevant session for this role";
  }
  if (entry.state.tone === "available") {
    return "No session yet for this role";
  }
  if (entry.state.tone === "optional") {
    return "Optional step for this task";
  }
  return "Blocked by workflow state";
};

function WorkflowStepContent({ step }: { step: AgentWorkflowStep }): ReactElement {
  const Icon = step.icon;
  const shouldSpinInProgress =
    step.state.liveSession !== "none" && isAgentSessionActivityWorking(step.state.liveSession);
  const attentionVariant = getWorkflowStepAttentionVariant(step);

  return (
    <>
      <Icon className={cn("size-4", AGENT_WORKFLOW_TONE_ICON_CLASSES[step.state.tone])} />
      {step.label}
      {step.state.tone === "done" ? <Check className="size-3.5 text-success-accent" /> : null}
      {attentionVariant === "session_waiting_input" ? <CircleDashed className="size-3.5" /> : null}
      {step.state.tone === "in_progress" && shouldSpinInProgress ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : null}
      {step.state.tone === "in_progress" && !shouldSpinInProgress ? (
        <CircleDotDashed className="size-3.5" />
      ) : null}
      {step.state.tone === "available" ? <Circle className="size-3" /> : null}
      {step.state.tone === "optional" ? <CircleDashed className="size-3" /> : null}
      {attentionVariant === "blocked_task" ? <AlertTriangle className="size-3.5" /> : null}
      {step.state.tone === "rejected" || step.state.tone === "failed" ? (
        <AlertTriangle className="size-3.5" />
      ) : null}
    </>
  );
}

/** Compact navigation using the same role buttons as the Agent Studio header. */
export function WorkflowRailPreview({
  steps,
  selectedRole,
  onStepSelect,
}: Pick<WorkflowRailProps, "steps" | "selectedRole" | "onStepSelect">): ReactElement {
  return (
    <ol aria-label="Task workflow" className="flex items-center gap-1 py-1">
      {steps.map((step, index) => (
        <li key={step.role} className="flex min-w-0 flex-1 items-center gap-1">
          <WorkflowStepButton
            step={step}
            isSelected={selectedRole === step.role}
            agentStudioReady
            onSelect={onStepSelect}
            compact
          />
          {index < steps.length - 1 ? (
            <ChevronRight
              aria-hidden="true"
              className={cn("size-3 shrink-0", workflowConnectorClassName(steps[index + 1]!.state))}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function WorkflowStepButton({
  step,
  isSelected,
  agentStudioReady,
  onSelect,
  compact = false,
}: {
  step: AgentWorkflowStep;
  isSelected: boolean;
  agentStudioReady: boolean;
  onSelect: (role: AgentRole, sessionValue: string | null) => void;
  compact?: boolean;
}): ReactElement {
  return (
    <Button
      type="button"
      size={compact ? "xs" : "sm"}
      variant="outline"
      className={cn(
        "border transition-none cursor-pointer",
        compact
          ? "h-7 min-w-0 flex-1 gap-1 rounded-md px-1.5 text-[11px] [&_svg]:size-3 [&_svg]:shrink-0"
          : "h-9 shrink-0 gap-2 rounded-lg px-4 text-sm @max-[480px]/workflow:gap-1 @max-[480px]/workflow:px-1.5 @max-[480px]/workflow:text-xs @max-[480px]/workflow:[&_svg]:size-3",
        workflowStepClassName(step.state),
        AGENT_WORKFLOW_TONE_TEXT_CLASSES[step.state.tone],
        workflowBorderStyleClassName(step.state),
        workflowSelectionClassName(isSelected, step.state),
        isSelected && compact && "ring-offset-1 ring-offset-popover",
      )}
      disabled={!agentStudioReady}
      aria-pressed={isSelected}
      aria-current={isSelected && compact ? "step" : undefined}
      title={workflowStepHint(step)}
      onClick={() => {
        onSelect(step.role, step.sessionValue);
      }}
    >
      <WorkflowStepContent step={step} />
    </Button>
  );
}

export function WorkflowRail({
  steps,
  selectedRole,
  agentStudioReady,
  onStepSelect,
}: WorkflowRailProps): ReactElement {
  return (
    <div className="flex w-max min-w-full items-center justify-center py-0.5">
      <div className="flex items-center gap-1">
        {steps.map((step, index) => {
          const nextStep = steps[index + 1] ?? null;
          return (
            <div
              key={step.role}
              className="flex min-w-0 items-center gap-2 @max-[480px]/workflow:gap-1"
            >
              <WorkflowStepButton
                step={step}
                isSelected={selectedRole === step.role}
                agentStudioReady={agentStudioReady}
                onSelect={onStepSelect}
              />
              {nextStep ? (
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 @max-[480px]/workflow:size-3",
                    workflowConnectorClassName(nextStep.state),
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
