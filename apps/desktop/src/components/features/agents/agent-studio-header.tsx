import type { AgentRole, AgentScenario } from "@openducktor/core";
import {
  AlertTriangle,
  ArrowUpRightFromSquare,
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDotDashed,
  LoaderCircle,
  Plus,
  Sparkles,
} from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxGroup } from "@/components/ui/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AgentWorkflowStepState } from "@/types/agent-workflow";
import type { AgentRoleOption } from "./agent-chat/agent-chat.types";

type AgentWorkflowStep = {
  role: AgentRole;
  label: string;
  icon: AgentRoleOption["icon"];
  state: AgentWorkflowStepState;
  sessionId: string | null;
};

type AgentStudioSessionSelectorModel = {
  value: string;
  groups: ComboboxGroup[];
  disabled: boolean;
  onValueChange: (value: string) => void;
};

type AgentSessionCreateOption = {
  id: string;
  role: AgentRole;
  scenario: AgentScenario;
  label: string;
  description: string;
  disabled: boolean;
};

export type AgentStudioHeaderModel = {
  taskTitle: string | null;
  taskId: string | null;
  onOpenTaskDetails: (() => void) | null;
  sessionStatus: "starting" | "running" | "idle" | "error" | "stopped" | null;
  selectedRole: AgentRole | null;
  workflowSteps: AgentWorkflowStep[];
  onWorkflowStepSelect: (role: AgentRole, sessionId: string | null) => void;
  sessionSelector: AgentStudioSessionSelectorModel;
  sessionCreateOptions: AgentSessionCreateOption[];
  onCreateSession: (option: AgentSessionCreateOption) => void;
  createSessionDisabled: boolean;
  isCreatingSession: boolean;
  stats: {
    sessions: number;
    messages: number;
    permissions: number;
    questions: number;
  };
  agentStudioReady: boolean;
};

const WORKFLOW_STEP_CLASSES: Record<AgentWorkflowStepState["tone"], string> = {
  in_progress: "border-info-border bg-info-surface hover:bg-info-surface text-info-muted shadow-sm",
  done: "border-success-border bg-success-surface hover:bg-success-surface text-success-muted shadow-sm",
  available: "border-input bg-card text-foreground",
  optional: "border-input bg-card text-foreground",
  rejected:
    "border-rose-300 bg-rose-50 text-rose-700 shadow-sm dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  waiting_input:
    "border-warning-border bg-warning-surface hover:bg-warning-surface text-warning-muted shadow-sm",
  failed:
    "border-destructive-border bg-destructive-surface hover:bg-destructive-surface text-destructive-muted shadow-sm",
  blocked: "border-border bg-muted text-muted-foreground",
};

const WORKFLOW_CONNECTOR_CLASSES: Record<AgentWorkflowStepState["tone"], string> = {
  done: "text-success-ring",
  in_progress: "text-info-ring",
  available: "text-muted-foreground/40",
  optional: "text-muted-foreground/40",
  rejected: "text-rose-500",
  waiting_input: "text-warning-ring",
  failed: "text-destructive-ring",
  blocked: "text-muted-foreground/20",
};

const WORKFLOW_SELECTION_CLASSES: Record<AgentWorkflowStepState["tone"], string> = {
  done: "ring-2 ring-offset-2 ring-offset-card ring-success-ring",
  in_progress: "ring-2 ring-offset-2 ring-offset-card ring-info-ring",
  available: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  optional: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  rejected: "ring-2 ring-offset-2 ring-offset-card ring-rose-400",
  waiting_input: "ring-2 ring-offset-2 ring-offset-card ring-warning-ring",
  failed: "ring-2 ring-offset-2 ring-offset-card ring-destructive-ring",
  blocked: "ring-2 ring-offset-2 ring-offset-card ring-warning-ring",
};

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
  state.tone === "optional" ? "border-dashed" : "";

const workflowStepHint = (entry: AgentWorkflowStep): string => {
  if (entry.state.liveSession === "waiting_input") {
    return "Session is waiting for input";
  }
  if (entry.state.liveSession === "running") {
    return "Step in progress";
  }
  if (entry.state.liveSession === "error") {
    return "Latest session failed";
  }
  if (entry.state.completion === "rejected") {
    return "Latest review rejected this task";
  }
  if (entry.sessionId) {
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

export function AgentStudioHeader({ model }: { model: AgentStudioHeaderModel }): ReactElement {
  const {
    taskTitle,
    taskId,
    selectedRole,
    workflowSteps,
    onWorkflowStepSelect,
    sessionSelector,
    sessionCreateOptions,
    onCreateSession,
    createSessionDisabled,
    isCreatingSession,
    agentStudioReady,
  } = model;

  const [isCreateSessionMenuOpen, setIsCreateSessionMenuOpen] = useState(false);

  const normalizedTaskTitle = taskTitle?.trim() ?? "";
  const hasTaskTitle = normalizedTaskTitle.length > 0;
  const normalizedTaskId = taskId?.trim() ?? "";
  const hasTaskId = normalizedTaskId.length > 0;
  const canOpenTaskDetails = hasTaskId && Boolean(model.onOpenTaskDetails);
  const sessionSelectorOptions = sessionSelector.groups.flatMap((group) => group.options);
  const createOptionsByRole = useMemo(
    () =>
      sessionCreateOptions.reduce(
        (acc, option) => {
          if (!acc[option.role]) {
            acc[option.role] = [];
          }
          acc[option.role].push(option);
          return acc;
        },
        {} as Record<AgentRole, AgentSessionCreateOption[]>,
      ),
    [sessionCreateOptions],
  );

  return (
    <CardHeader className="space-y-2 border-b border-border bg-card pb-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <CardTitle className="max-w-160 truncate text-xl">
              {hasTaskTitle ? normalizedTaskTitle : "Agent Studio"}
            </CardTitle>
            {canOpenTaskDetails ? (
              <Button
                type="button"
                variant="ghost"
                className="h-auto shrink-0 gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground transition hover:border-border hover:bg-muted hover:text-muted-foreground"
                title="Open task details"
                aria-label="Open task details"
                onClick={() => model.onOpenTaskDetails?.()}
              >
                <ArrowUpRightFromSquare className="size-3" />
                Open
              </Button>
            ) : null}
          </div>
          {hasTaskId ? (
            <p className="font-mono text-[11px] text-muted-foreground">{normalizedTaskId}</p>
          ) : null}
        </div>
        <div className="flex min-w-56 max-w-full items-stretch gap-2 sm:min-w-[18rem]">
          <div className="min-w-0 flex-1">
            <Combobox
              value={sessionSelector.value}
              options={sessionSelectorOptions}
              groups={sessionSelector.groups}
              placeholder="Select session"
              disabled={sessionSelector.disabled || !agentStudioReady}
              onValueChange={sessionSelector.onValueChange}
            />
          </div>
          <Popover open={isCreateSessionMenuOpen} onOpenChange={setIsCreateSessionMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="default"
                size="icon"
                className="h-9 w-9 rounded-md"
                disabled={!agentStudioReady || createSessionDisabled || isCreatingSession}
                title="Create session"
                aria-label="Create session"
              >
                <Plus className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <Command>
                <CommandList>
                  <CommandEmpty>No session types available.</CommandEmpty>
                  {(
                    Object.entries(createOptionsByRole) as [AgentRole, AgentSessionCreateOption[]][]
                  ).map(([role, options]) => (
                    <CommandGroup key={role} heading={role.toUpperCase()}>
                      {options.map((option) => (
                        <CommandItem
                          key={option.id}
                          disabled={option.disabled}
                          onSelect={() => {
                            if (option.disabled) {
                              return;
                            }
                            onCreateSession(option);
                            setIsCreateSessionMenuOpen(false);
                          }}
                        >
                          <Sparkles className="size-3.5 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {option.label}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {option.description}
                            </p>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex items-center justify-center py-0.5">
        <div className="flex items-center gap-1">
          {workflowSteps.map((entry, index) => {
            const Icon = entry.icon;
            const isSelected = selectedRole === entry.role;
            const shouldSpinInProgress = entry.state.liveSession === "running";
            const nextStep = workflowSteps[index + 1] ?? null;
            return (
              <div key={entry.role} className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-10 shrink-0 gap-2 rounded-lg border px-4 text-sm transition-colors",
                    workflowStepClassName(entry.state),
                    workflowBorderStyleClassName(entry.state),
                    workflowSelectionClassName(isSelected, entry.state),
                    "cursor-pointer",
                  )}
                  disabled={!agentStudioReady}
                  title={workflowStepHint(entry)}
                  onClick={() => {
                    onWorkflowStepSelect(entry.role, entry.sessionId);
                  }}
                >
                  <Icon className="size-4" />
                  {entry.label}
                  {entry.state.tone === "done" ? (
                    <Check className="size-3.5 text-success-accent" />
                  ) : null}
                  {entry.state.liveSession === "waiting_input" ? (
                    <CircleDashed className="size-3.5" />
                  ) : null}
                  {entry.state.tone === "in_progress" && shouldSpinInProgress ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {entry.state.tone === "in_progress" && !shouldSpinInProgress ? (
                    <CircleDotDashed className="size-3.5" />
                  ) : null}
                  {entry.state.tone === "available" ? <Circle className="size-3" /> : null}
                  {entry.state.tone === "optional" ? <CircleDashed className="size-3" /> : null}
                  {entry.state.tone === "rejected" || entry.state.tone === "failed" ? (
                    <AlertTriangle className="size-3.5" />
                  ) : null}
                </Button>
                {nextStep ? (
                  <ChevronRight
                    className={cn("size-4 shrink-0", workflowConnectorClassName(nextStep.state))}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </CardHeader>
  );
}
