import { Badge } from "@/components/ui/badge";
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
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { Check, Circle, CircleDotDashed, LoaderCircle, Plus, Sparkles } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import type { AgentRoleOption } from "./agent-chat/agent-chat.types";

type AgentWorkflowStep = {
  role: AgentRole;
  label: string;
  icon: AgentRoleOption["icon"];
  state: "done" | "current" | "available" | "blocked";
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
  workflowSteps: AgentWorkflowStep[];
  onWorkflowStepSelect: (role: AgentRole, sessionId: string | null) => void;
  sessionSelector: AgentStudioSessionSelectorModel;
  sessionCreateOptions: AgentSessionCreateOption[];
  onCreateSession: (role: AgentRole, scenario: AgentScenario) => void;
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

const statusBadgeVariant = (status: string): "default" | "warning" | "danger" | "success" => {
  if (status === "running" || status === "starting") {
    return "warning";
  }
  if (status === "error") {
    return "danger";
  }
  if (status === "idle") {
    return "default";
  }
  return "success";
};

const workflowStepClassName = (state: AgentWorkflowStep["state"]): string => {
  if (state === "current") {
    return "border-sky-300 bg-sky-50 text-sky-700 shadow-sm";
  }
  if (state === "done") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm";
  }
  if (state === "available") {
    return "border-slate-300 bg-white text-slate-700 hover:border-sky-200 hover:text-sky-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-400";
};

const workflowConnectorClassName = (state: AgentWorkflowStep["state"]): string => {
  if (state === "done" || state === "current") {
    return "bg-emerald-300";
  }
  if (state === "available") {
    return "bg-slate-300";
  }
  return "bg-slate-200";
};

const workflowStepHint = (entry: AgentWorkflowStep): string => {
  if (entry.sessionId) {
    if (entry.state === "current") {
      return "Current session role";
    }
    return "Open latest session for this role";
  }
  if (entry.state === "available") {
    return "No session yet for this role";
  }
  return "Blocked by workflow state";
};

export function AgentStudioHeader({ model }: { model: AgentStudioHeaderModel }): ReactElement {
  const {
    taskTitle,
    taskId,
    sessionStatus,
    workflowSteps,
    onWorkflowStepSelect,
    sessionSelector,
    sessionCreateOptions,
    onCreateSession,
    createSessionDisabled,
    isCreatingSession,
    stats,
    agentStudioReady,
  } = model;

  const [isCreateSessionMenuOpen, setIsCreateSessionMenuOpen] = useState(false);

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
    <CardHeader className="space-y-3 border-b border-slate-200 bg-white pb-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="max-w-[40rem] truncate text-xl">
            {hasTaskTitle ? normalizedTaskTitle : "Agent Studio"}
          </CardTitle>
          {hasTaskId ? (
            <p className="font-mono text-[11px] text-slate-500">{normalizedTaskId}</p>
          ) : null}
        </div>
        {sessionStatus ? (
          <Badge variant={statusBadgeVariant(sessionStatus)}>
            <CircleDotDashed className="mr-1 size-3" />
            {sessionStatus}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center justify-center overflow-x-auto py-1">
        <div className="flex items-center gap-1">
          {workflowSteps.map((entry, index) => {
            const Icon = entry.icon;
            const isClickable = Boolean(entry.sessionId);
            const shouldSpinCurrent =
              entry.state === "current" &&
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
                    isClickable ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                  disabled={!agentStudioReady || !isClickable}
                  title={workflowStepHint(entry)}
                  onClick={() => onWorkflowStepSelect(entry.role, entry.sessionId)}
                >
                  <Icon className="size-4" />
                  {entry.label}
                  {entry.state === "done" ? <Check className="size-3.5 text-emerald-600" /> : null}
                  {entry.state === "current" && shouldSpinCurrent ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {entry.state === "current" && !shouldSpinCurrent ? (
                    <CircleDotDashed className="size-3.5" />
                  ) : null}
                  {entry.state === "available" ? <Circle className="size-3" /> : null}
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

      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          Viewing Session
        </p>
        <div className="flex items-stretch gap-2">
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
                            onCreateSession(option.role, option.scenario);
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

      {createSessionDisabled ? (
        <p className="text-xs text-slate-500">
          Session creation is locked while the current session is actively running.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>
          Sessions: <strong>{stats.sessions}</strong>
        </span>
        <span>
          Messages: <strong>{stats.messages}</strong>
        </span>
        <span>
          Permissions: <strong>{stats.permissions}</strong>
        </span>
        <span>
          Questions: <strong>{stats.questions}</strong>
        </span>
      </div>
    </CardHeader>
  );
}
