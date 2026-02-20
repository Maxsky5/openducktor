import { TaskSelector } from "@/components/features/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { TaskCard } from "@openblueprint/contracts";
import type { AgentRole, AgentScenario } from "@openblueprint/core";
import { CircleDotDashed, LoaderCircle, Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import type { AgentRoleOption } from "./agent-chat/agent-chat.types";

export type AgentStudioHeaderModel = {
  sessionStatus: "starting" | "running" | "idle" | "error" | "stopped" | null;
  taskId: string;
  tasks: TaskCard[];
  onTaskChange: (taskId: string) => void;
  selectedTaskTitle: string | null;
  roleOptions: AgentRoleOption[];
  role: AgentRole;
  onRoleChange: (role: AgentRole) => void;
  sessionOptions: ComboboxOption[];
  selectedSessionValue: string;
  onSessionChange: (sessionId: string) => void;
  scenario: AgentScenario;
  scenarioOptions: ComboboxOption[];
  scenarioDisabled: boolean;
  onScenarioChange: (scenario: string) => void;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  onKickoff: () => void;
  isStarting: boolean;
  isSending: boolean;
  showFollowLatest: boolean;
  onFollowLatest: () => void;
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

export function AgentStudioHeader({
  model,
}: {
  model: AgentStudioHeaderModel;
}): ReactElement {
  const {
    sessionStatus,
    taskId,
    tasks,
    onTaskChange,
    selectedTaskTitle,
    roleOptions,
    role,
    onRoleChange,
    sessionOptions,
    selectedSessionValue,
    onSessionChange,
    scenario,
    scenarioOptions,
    scenarioDisabled,
    onScenarioChange,
    canKickoffNewSession,
    kickoffLabel,
    onKickoff,
    isStarting,
    isSending,
    showFollowLatest,
    onFollowLatest,
    stats,
    agentStudioReady,
  } = model;

  return (
    <CardHeader className="space-y-3 border-b border-slate-200 bg-white pb-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-xl">Agent Studio</CardTitle>
          <CardDescription>
            Chat-first workspace for Spec, Planner, Build, and QA orchestration.
          </CardDescription>
        </div>
        {sessionStatus ? (
          <Badge variant={statusBadgeVariant(sessionStatus)}>
            <CircleDotDashed className="mr-1 size-3" />
            {sessionStatus}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(280px,1fr)_auto]">
        <div className="min-w-0">
          <TaskSelector
            tasks={tasks}
            value={taskId}
            disabled={!agentStudioReady}
            onValueChange={onTaskChange}
          />
        </div>
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
                disabled={!agentStudioReady}
                onClick={() => onRoleChange(entry.role)}
              >
                <Icon className="size-3.5" />
                {entry.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_240px_1fr]">
        <Combobox
          value={selectedSessionValue}
          options={sessionOptions}
          placeholder={
            sessionOptions.length > 0
              ? "Select session (latest used by default)"
              : "No session yet for this task/role"
          }
          searchPlaceholder="Search sessions..."
          emptyText="No matching session."
          disabled={!taskId || !agentStudioReady}
          onValueChange={onSessionChange}
        />
        <Combobox
          value={scenario}
          options={scenarioOptions}
          placeholder="Select scenario"
          disabled={scenarioDisabled || !agentStudioReady}
          onValueChange={onScenarioChange}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          {selectedTaskTitle ? (
            <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">
              {selectedTaskTitle}
            </Badge>
          ) : (
            <span>Select a task to chat.</span>
          )}
          {canKickoffNewSession ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={isStarting || isSending || !taskId || !agentStudioReady}
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
          {showFollowLatest ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={onFollowLatest}
            >
              Follow Latest
            </Button>
          ) : null}
        </div>
      </div>
    </CardHeader>
  );
}
