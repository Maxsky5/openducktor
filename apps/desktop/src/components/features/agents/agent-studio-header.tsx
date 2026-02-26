import type { AgentRole, AgentScenario } from "@openducktor/core";
import {
  Check,
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

const workflowStepClassName = (state: AgentWorkflowStep["state"]): string => {
  if (state === "in_progress") {
    return "border-sky-300 bg-sky-50 hover:bg-sky-50 text-sky-700 shadow-sm";
  }
  if (state === "done") {
    return "border-emerald-300 bg-emerald-50 hover:bg-emerald-50 text-emerald-700 shadow-sm";
  }
  if (state === "available") {
    return "border-slate-300 bg-white text-slate-700";
  }
  if (state === "optional") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-400";
};

const workflowConnectorClassName = (state: AgentWorkflowStep["state"]): string => {
  if (state === "done") {
    return "bg-emerald-300";
  }
  if (state === "in_progress") {
    return "bg-sky-300";
  }
  if (state === "available") {
    return "bg-slate-300";
  }
  if (state === "optional") {
    return "bg-amber-300";
  }
  return "bg-slate-200";
};

const workflowSelectionClassName = (isSelected: boolean): string => {
  return isSelected ? "ring-3 ring-offset-3 ring-blue-400" : "";
};

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
    sessionStatus,
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
    <CardHeader className="space-y-2 border-b border-slate-200 bg-white pb-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="max-w-[40rem] truncate text-xl">
            {hasTaskTitle ? normalizedTaskTitle : "Agent Studio"}
          </CardTitle>
          {hasTaskId ? (
            <p className="font-mono text-[11px] text-slate-500">{normalizedTaskId}</p>
          ) : null}
        </div>
        <div className="flex min-w-[14rem] max-w-full items-stretch gap-2 sm:min-w-[18rem]">
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
                          <Sparkles className="size-3.5 text-slate-500" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">
                              {option.label}
                            </p>
                            <p className="truncate text-[11px] text-slate-500">
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
            const shouldSpinInProgress =
              entry.state === "in_progress" &&
              (sessionStatus === "running" || sessionStatus === "starting");
            return (
              <div key={entry.role} className="flex min-w-0 items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-10 shrink-0 gap-2 rounded-lg border px-4 text-sm transition-colors",
                    workflowStepClassName(entry.state),
                    workflowSelectionClassName(isSelected),
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
                  {entry.state === "done" ? <Check className="size-3.5 text-emerald-600" /> : null}
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
                  <span
                    className={cn(
                      "h-px w-7 shrink-0 rounded-full",
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
        <p className="text-xs text-slate-500">
          Session creation is locked while the current session is actively running.
        </p>
      ) : null}
    </CardHeader>
  );
}
