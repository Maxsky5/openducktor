import type { AgentRole, AgentScenario } from "@openducktor/core";
import {
  AlertTriangle,
  ArrowUpRightFromSquare,
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDotDashed,
  History,
  LoaderCircle,
  Plus,
  Sparkles,
} from "lucide-react";
import { type ReactElement, useMemo, useRef, useState } from "react";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import type { ComboboxGroup } from "@/components/ui/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
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

type WorkflowStepAttentionVariant = "none" | "session_waiting_input" | "blocked_task";

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
  agentStudioReady: boolean;
};

const WORKFLOW_STEP_CLASSES: Record<AgentWorkflowStepState["tone"], string> = {
  in_progress: "border-info-border bg-info-surface hover:bg-info-surface text-info-muted shadow-sm",
  done: "border-success-border bg-success-surface hover:bg-success-surface text-success-muted shadow-sm",
  available: "border-input bg-card text-foreground",
  optional: "border-input bg-card text-foreground",
  rejected:
    "border-rejected-border bg-rejected-surface text-rejected-muted shadow-sm hover:bg-rejected-surface",
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
  rejected: "text-rejected-ring",
  waiting_input: "text-warning-ring",
  failed: "text-destructive-ring",
  blocked: "text-muted-foreground/20",
};

const WORKFLOW_SELECTION_CLASSES: Record<AgentWorkflowStepState["tone"], string> = {
  done: "ring-2 ring-offset-2 ring-offset-card ring-success-ring",
  in_progress: "ring-2 ring-offset-2 ring-offset-card ring-info-ring",
  available: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  optional: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  rejected: "ring-2 ring-offset-2 ring-offset-card ring-rejected-ring",
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
  if (entry.state.liveSession === "running") {
    return "Step in progress";
  }
  if (entry.state.liveSession === "error") {
    return "Latest session failed";
  }
  if (entry.state.tone === "failed") {
    if (entry.sessionId) {
      return "Open latest failed session for this role";
    }
    return "Step failed before a session could start";
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
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const preventSessionTriggerRefocusRef = useRef(false);

  const normalizedTaskTitle = taskTitle?.trim() ?? "";
  const hasTaskTitle = normalizedTaskTitle.length > 0;
  const normalizedTaskId = taskId?.trim() ?? "";
  const hasTaskId = normalizedTaskId.length > 0;
  const canOpenTaskDetails = hasTaskId && Boolean(model.onOpenTaskDetails);
  const sessionGroupsWithOptions = useMemo(
    () => sessionSelector.groups.filter((group) => group.options.length > 0),
    [sessionSelector.groups],
  );
  const sessionSelectorOptions = useMemo(
    () => sessionGroupsWithOptions.flatMap((group) => group.options),
    [sessionGroupsWithOptions],
  );
  const selectedSessionOption = useMemo(
    () => sessionSelectorOptions.find((option) => option.value === sessionSelector.value) ?? null,
    [sessionSelector.value, sessionSelectorOptions],
  );
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
    <CardHeader className="border-b border-border bg-card pb-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <CardTitle
              className="truncate text-xl"
              title={hasTaskTitle ? normalizedTaskTitle : undefined}
            >
              {hasTaskTitle ? normalizedTaskTitle : "Agent Studio"}
            </CardTitle>
          </div>
          {hasTaskId ? (
            <div className="mt-1 flex items-center gap-1.5">
              <TaskIdBadge taskId={normalizedTaskId} />
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
          ) : null}
        </div>
        <div className="flex shrink-0 items-stretch gap-2">
          <Popover open={isSessionMenuOpen} onOpenChange={setIsSessionMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-md"
                disabled={sessionSelector.disabled || !agentStudioReady}
                title={
                  selectedSessionOption
                    ? `Session history · ${selectedSessionOption.label}`
                    : "Session history"
                }
                aria-label={
                  selectedSessionOption
                    ? `Session history, selected ${selectedSessionOption.label}`
                    : "Session history"
                }
              >
                <History className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 p-0"
              onCloseAutoFocus={(event) => {
                if (!preventSessionTriggerRefocusRef.current) {
                  return;
                }

                preventSessionTriggerRefocusRef.current = false;
                event.preventDefault();
              }}
            >
              <Command>
                <CommandInput placeholder="Search sessions…" className="h-8 text-sm" />
                <CommandList>
                  <CommandEmpty>No sessions available.</CommandEmpty>
                  {sessionGroupsWithOptions.map((group) => (
                    <CommandGroup key={group.label} heading={group.label}>
                      {group.options.map((option) => (
                        <CommandItem
                          key={option.value}
                          value={`${group.label} ${option.label} ${option.description ?? ""}`}
                          onSelect={() => {
                            preventSessionTriggerRefocusRef.current =
                              option.value !== sessionSelector.value;
                            sessionSelector.onValueChange(option.value);
                            setIsSessionMenuOpen(false);
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {option.label}
                            </p>
                            {option.description ? (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {option.description}
                              </p>
                            ) : null}
                          </div>
                          {sessionSelector.value === option.value ? (
                            <Check className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
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
            const attentionVariant = getWorkflowStepAttentionVariant(entry);
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
                  {attentionVariant === "session_waiting_input" ? (
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
                  {attentionVariant === "blocked_task" ? (
                    <AlertTriangle className="size-3.5" />
                  ) : null}
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
