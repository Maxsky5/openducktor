import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { AgentRole, AgentScenario } from "@openducktor/core";
import { CircleDotDashed, LoaderCircle, Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import type { AgentRoleOption } from "./agent-chat/agent-chat.types";

export type AgentStudioHeaderModel = {
  taskTitle: string | null;
  sessionStatus: "starting" | "running" | "idle" | "error" | "stopped" | null;
  roleOptions: AgentRoleOption[];
  role: AgentRole;
  roleDisabled: boolean;
  onRoleChange: (role: AgentRole) => void;
  scenario: AgentScenario;
  scenarioOptions: ComboboxOption[];
  scenarioDisabled: boolean;
  onScenarioChange: (scenario: string) => void;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  onKickoff: () => void;
  isStarting: boolean;
  isSending: boolean;
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

export function AgentStudioHeader({ model }: { model: AgentStudioHeaderModel }): ReactElement {
  const {
    taskTitle,
    sessionStatus,
    roleOptions,
    role,
    roleDisabled,
    onRoleChange,
    scenario,
    scenarioOptions,
    scenarioDisabled,
    onScenarioChange,
    canKickoffNewSession,
    kickoffLabel,
    onKickoff,
    isStarting,
    isSending,
    stats,
    agentStudioReady,
  } = model;

  const normalizedTaskTitle = taskTitle?.trim() ?? "";
  const hasTaskTitle = normalizedTaskTitle.length > 0;

  return (
    <CardHeader className="space-y-3 border-b border-slate-200 bg-white pb-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {hasTaskTitle ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Agent Studio
            </p>
          ) : null}
          <CardTitle className="max-w-[40rem] truncate text-xl">
            {hasTaskTitle ? normalizedTaskTitle : "Agent Studio"}
          </CardTitle>
          <CardDescription>
            {hasTaskTitle
              ? "Chat-first workspace for this task session."
              : "Chat-first workspace for Spec, Planner, Build, and QA orchestration."}
          </CardDescription>
        </div>
        {sessionStatus ? (
          <Badge variant={statusBadgeVariant(sessionStatus)}>
            <CircleDotDashed className="mr-1 size-3" />
            {sessionStatus}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-2 lg:grid-cols-[auto_1fr]">
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {roleOptions.map((entry) => {
            const Icon = entry.icon;
            const active = role === entry.role;
            return (
              <Button
                key={entry.role}
                type="button"
                size="sm"
                variant={active ? "default" : "ghost"}
                className={cn("h-8", active ? "" : "hover:bg-white")}
                disabled={!agentStudioReady || roleDisabled}
                onClick={() => onRoleChange(entry.role)}
              >
                <Icon className="size-3.5" />
                {entry.label}
              </Button>
            );
          })}
        </div>
        <Combobox
          value={scenario}
          options={scenarioOptions}
          placeholder="Select scenario"
          disabled={scenarioDisabled || !agentStudioReady}
          onValueChange={onScenarioChange}
        />
      </div>

      {roleDisabled ? (
        <p className="text-xs text-slate-500">
          Role is locked while the task already has an active session.
        </p>
      ) : null}

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {canKickoffNewSession ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={isStarting || isSending || !agentStudioReady}
              onClick={onKickoff}
            >
              {isStarting ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {kickoffLabel}
            </Button>
          ) : null}
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
      </div>
    </CardHeader>
  );
}
