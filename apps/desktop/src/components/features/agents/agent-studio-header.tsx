import type { AgentRole, AgentScenario } from "@openducktor/core";
import {
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDotDashed,
  LoaderCircle,
  Plus,
  Sparkles,
} from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
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
  hasRunningSession: boolean;
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

const WORKFLOW_STEP_CLASSES: Record<AgentWorkflowStep["state"] | "blocked", string> = {
  in_progress:
    "border-info-border bg-info-surface hover:bg-info-surface text-info-muted shadow-sm",
  done: "border-success-border bg-success-surface hover:bg-success-surface text-success-muted shadow-sm",
  available: "border-input bg-card text-foreground",
  optional:
    "border-warning-border bg-warning-surface text-warning-muted",
  blocked: "border-border bg-muted text-muted-foreground",
};

const WORKFLOW_CONNECTOR_CLASSES: Record<AgentWorkflowStep["state"] | "blocked", string> = {
  done: "text-success-ring",
  in_progress: "text-info-ring",
  available: "text-muted-foreground/40",
  optional: "text-warning-ring",
  blocked: "text-muted-foreground/20",
};

const WORKFLOW_SELECTION_CLASSES: Record<AgentWorkflowStep["state"] | "blocked", string> = {
  done: "ring-2 ring-offset-2 ring-offset-card ring-success-ring",
  in_progress: "ring-2 ring-offset-2 ring-offset-card ring-info-ring",
  available: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  optional: "ring-2 ring-offset-2 ring-offset-card ring-warning-ring",
  blocked: "ring-2 ring-offset-2 ring-offset-card ring-warning-ring",
};

const workflowStepClassName = (state: AgentWorkflowStep["state"]): string =>
  WORKFLOW_STEP_CLASSES[state] ?? WORKFLOW_STEP_CLASSES.blocked;

const workflowConnectorClassName = (state: AgentWorkflowStep["state"] | "blocked"): string =>
  WORKFLOW_CONNECTOR_CLASSES[state] ?? WORKFLOW_CONNECTOR_CLASSES.blocked;

const workflowSelectionClassName = (
  isSelected: boolean,
  state: AgentWorkflowStep["state"],
): string =>
  isSelected ? (WORKFLOW_SELECTION_CLASSES[state] ?? WORKFLOW_SELECTION_CLASSES.blocked) : "";

const workflowStepHint = (entry: AgentWorkflowStep): string => {
  if (entry.sessionId) {
    if (entry.state === "in_progress") {
      return "Step in progress";
    }
    return "Open latest session for this role";
  }
  if (entry.state === "available") {
    return "No session yet for this role";
  }
  if (entry.state === "optional") {
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
  const [optimisticSelectedRole, setOptimisticSelectedRole] = useState<AgentRole | null>(
    selectedRole,
  );

  useEffect(() => {
    setOptimisticSelectedRole(selectedRole);
  }, [selectedRole]);

  const normalizedTaskTitle = taskTitle?.trim() ?? "";
  const hasTaskTitle = normalizedTaskTitle.length > 0;
  const normalizedTaskId = taskId?.trim() ?? "";
  const hasTaskId = normalizedTaskId.length > 0;
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
          <CardTitle className="max-w-160 truncate text-xl">
            {hasTaskTitle ? normalizedTaskTitle : "Agent Studio"}
          </CardTitle>
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
                disabled={!agentStudioReady || createSessionDisabled}
                title="Create session"
                aria-label="Create session"
              >
                {isCreatingSession ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
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
            const isSelected = optimisticSelectedRole === entry.role;
            const shouldSpinInProgress = entry.state === "in_progress" && entry.hasRunningSession;
            return (
              <div key={entry.role} className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-10 shrink-0 gap-2 rounded-lg border px-4 text-sm transition-colors",
                    workflowStepClassName(entry.state),
                    workflowSelectionClassName(isSelected, entry.state),
                    "cursor-pointer",
                  )}
                  disabled={!agentStudioReady}
                  title={workflowStepHint(entry)}
                  onClick={() => {
                    setOptimisticSelectedRole(entry.role);
                    onWorkflowStepSelect(entry.role, entry.sessionId);
                  }}
                >
                  <Icon className="size-4" />
                  {entry.label}
                  {entry.state === "done" ? <Check className="size-3.5 text-success-accent" /> : null}
                  {entry.state === "in_progress" && shouldSpinInProgress ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {entry.state === "in_progress" && !shouldSpinInProgress ? (
                    <CircleDotDashed className="size-3.5" />
                  ) : null}
                  {entry.state === "available" ? <Circle className="size-3" /> : null}
                  {entry.state === "optional" ? <CircleDashed className="size-3" /> : null}
                </Button>
                {index < workflowSteps.length - 1 ? (
                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0",
                      workflowConnectorClassName(workflowSteps[index + 1]?.state ?? "blocked"),
                    )}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {createSessionDisabled ? (
        <p className="text-xs text-muted-foreground">
          Session creation is locked while the current session is actively running.
        </p>
      ) : null}
    </CardHeader>
  );
}
