import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import { TaskSelector } from "@/components/features/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComboboxOption } from "@/components/ui/combobox";
import { Combobox } from "@/components/ui/combobox";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAgentState, useTasksState, useWorkspaceState } from "@/state";
import type { AgentRole, AgentScenario } from "@openblueprint/core";
import {
  Bot,
  Brain,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const ROLE_OPTIONS: Array<{
  role: AgentRole;
  label: string;
  icon: typeof Sparkles;
}> = [
  { role: "spec", label: "Spec", icon: Sparkles },
  { role: "planner", label: "Planner", icon: Bot },
  { role: "build", label: "Build", icon: Wrench },
  { role: "qa", label: "QA", icon: ShieldCheck },
];

const SCENARIOS_BY_ROLE: Record<AgentRole, AgentScenario[]> = {
  spec: ["spec_initial", "spec_revision"],
  planner: ["planner_initial", "planner_revision"],
  build: [
    "build_implementation_start",
    "build_after_qa_rejected",
    "build_after_human_request_changes",
  ],
  qa: ["qa_review"],
};

const isRole = (value: string | null): value is AgentRole =>
  value === "spec" || value === "planner" || value === "build" || value === "qa";

const isScenario = (value: string | null): value is AgentScenario =>
  value === "spec_initial" ||
  value === "spec_revision" ||
  value === "planner_initial" ||
  value === "planner_revision" ||
  value === "build_implementation_start" ||
  value === "build_after_qa_rejected" ||
  value === "build_after_human_request_changes" ||
  value === "qa_review";

const firstScenario = (role: AgentRole): AgentScenario => {
  const scenarios = SCENARIOS_BY_ROLE[role];
  const first = scenarios[0];
  if (first) {
    return first;
  }
  return "spec_initial";
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

export function AgentsPage(): ReactElement {
  const { activeRepo } = useWorkspaceState();
  const { tasks } = useTasksState();
  const {
    sessions,
    startAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  } = useAgentState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [input, setInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const autoStartExecutedRef = useRef(new Set<string>());

  const taskId = searchParams.get("task") ?? "";
  const roleParam = searchParams.get("agent");
  const role: AgentRole = isRole(roleParam) ? roleParam : "spec";
  const scenarioParam = searchParams.get("scenario");
  const scenarioFromQuery: AgentScenario | undefined = isScenario(scenarioParam)
    ? scenarioParam
    : undefined;
  const autostart = searchParams.get("autostart") === "1";

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === taskId) ?? null,
    [taskId, tasks],
  );

  const scenarios = SCENARIOS_BY_ROLE[role];
  const scenario =
    scenarioFromQuery && scenarios.includes(scenarioFromQuery)
      ? scenarioFromQuery
      : firstScenario(role);

  const activeSession = useMemo(() => {
    return sessions
      .filter((entry) => entry.taskId === taskId && entry.role === role)
      .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))[0];
  }, [role, sessions, taskId]);

  const { specDoc, planDoc, qaDoc, ensureDocumentLoaded } = useTaskDocuments(taskId || null, true);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    ensureDocumentLoaded("spec");
    ensureDocumentLoaded("plan");
    ensureDocumentLoaded("qa");
  }, [ensureDocumentLoaded, taskId]);

  const updateQuery = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (!value) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const startSession = useCallback(
    async (sendKickoff = false): Promise<void> => {
      if (!taskId) {
        return;
      }
      setIsStarting(true);
      try {
        await startAgentSession({ taskId, role, scenario, sendKickoff });
        await updateQuery({ autostart: undefined });
      } finally {
        setIsStarting(false);
      }
    },
    [role, scenario, startAgentSession, taskId, updateQuery],
  );

  useEffect(() => {
    if (!autostart || !activeRepo || !taskId || activeSession) {
      return;
    }
    const key = `${taskId}:${role}:${scenario}`;
    if (autoStartExecutedRef.current.has(key)) {
      return;
    }
    autoStartExecutedRef.current.add(key);
    void startSession(true);
  }, [activeRepo, activeSession, autostart, role, scenario, startSession, taskId]);

  const onSend = useCallback(async (): Promise<void> => {
    const message = input.trim();
    if (!activeSession || !message) {
      return;
    }
    setInput("");
    setIsSending(true);
    try {
      await sendAgentMessage(activeSession.sessionId, message);
    } finally {
      setIsSending(false);
    }
  }, [activeSession, input, sendAgentMessage]);

  const providerOptions = useMemo<ComboboxOption[]>(() => {
    if (!activeSession?.modelCatalog) {
      return [];
    }
    const providers = new Map<string, string>();
    for (const entry of activeSession.modelCatalog.models) {
      providers.set(entry.providerId, entry.providerName);
    }
    return [...providers.entries()].map(([value, label]) => ({
      value,
      label,
    }));
  }, [activeSession?.modelCatalog]);

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    if (!activeSession?.modelCatalog || !activeSession.selectedModel) {
      return [];
    }
    return activeSession.modelCatalog.models
      .filter((entry) => entry.providerId === activeSession.selectedModel?.providerId)
      .map((entry) => ({
        value: `${entry.providerId}::${entry.modelId}`,
        label: entry.modelName,
        description: entry.modelId,
        searchKeywords: entry.variants.map((variant) => `variant:${variant}`),
      }));
  }, [activeSession?.modelCatalog, activeSession?.selectedModel]);

  const variantOptions = useMemo(() => {
    if (!activeSession?.modelCatalog || !activeSession.selectedModel) {
      return [];
    }
    const selectedModelEntry = activeSession.modelCatalog.models.find(
      (entry) =>
        entry.providerId === activeSession.selectedModel?.providerId &&
        entry.modelId === activeSession.selectedModel?.modelId,
    );
    if (!selectedModelEntry) {
      return [];
    }
    return selectedModelEntry.variants.map((variant) => ({
      value: variant,
      label: variant,
    }));
  }, [activeSession?.modelCatalog, activeSession?.selectedModel]);

  return (
    <div className="grid h-full min-w-0 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Agents Workspace</CardTitle>
          <CardDescription>
            Unified Spec, Planner, Build, and QA execution surface powered by OpenCode sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[260px]">
              <TaskSelector
                tasks={tasks}
                value={taskId}
                onValueChange={(nextTaskId) => {
                  updateQuery({
                    task: nextTaskId || undefined,
                    autostart: undefined,
                  });
                }}
              />
            </div>
            {ROLE_OPTIONS.map((entry) => {
              const Icon = entry.icon;
              const active = role === entry.role;
              return (
                <Button
                  key={entry.role}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() =>
                    updateQuery({
                      agent: entry.role,
                      scenario: firstScenario(entry.role),
                      autostart: undefined,
                    })
                  }
                >
                  <Icon className="size-3.5" />
                  {entry.label}
                </Button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {scenarios.map((entry) => (
              <Button
                key={entry}
                type="button"
                size="sm"
                variant={scenario === entry ? "secondary" : "outline"}
                className={cn(
                  "h-8",
                  scenario === entry ? "border-sky-200 bg-sky-50 text-sky-700" : "",
                )}
                onClick={() => updateQuery({ scenario: entry, autostart: undefined })}
              >
                {entry}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={!activeRepo || !taskId || isStarting}
              onClick={() => void startSession(false)}
            >
              {isStarting ? "Starting..." : "Start Session"}
            </Button>
            {activeSession ? (
              <>
                <Badge variant={statusBadgeVariant(activeSession.status)}>
                  {activeSession.status}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void stopAgentSession(activeSession.sessionId)}
                >
                  Stop Session
                </Button>
              </>
            ) : null}
            {selectedTask ? (
              <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">
                {selectedTask.title}
              </Badge>
            ) : null}
          </div>

          {activeSession ? (
            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Provider
                </p>
                <Combobox
                  value={activeSession.selectedModel?.providerId ?? ""}
                  options={providerOptions}
                  placeholder={
                    activeSession.isLoadingModelCatalog ? "Loading providers..." : "Select provider"
                  }
                  disabled={!activeSession || activeSession.isLoadingModelCatalog}
                  onValueChange={(providerId) => {
                    if (!activeSession.modelCatalog) {
                      return;
                    }
                    const firstModel = activeSession.modelCatalog.models.find(
                      (entry) => entry.providerId === providerId,
                    );
                    if (!firstModel) {
                      return;
                    }
                    updateAgentSessionModel(activeSession.sessionId, {
                      providerId,
                      modelId: firstModel.modelId,
                      ...(firstModel.variants[0] ? { variant: firstModel.variants[0] } : {}),
                    });
                  }}
                />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Model
                </p>
                <Combobox
                  value={
                    activeSession.selectedModel
                      ? `${activeSession.selectedModel.providerId}::${activeSession.selectedModel.modelId}`
                      : ""
                  }
                  options={modelOptions}
                  placeholder={
                    activeSession.isLoadingModelCatalog ? "Loading models..." : "Select model"
                  }
                  disabled={!activeSession.selectedModel || activeSession.isLoadingModelCatalog}
                  onValueChange={(nextValue) => {
                    const [providerId, modelId] = nextValue.split("::");
                    if (!providerId || !modelId || !activeSession.modelCatalog) {
                      return;
                    }
                    const model = activeSession.modelCatalog.models.find(
                      (entry) => entry.providerId === providerId && entry.modelId === modelId,
                    );
                    if (!model) {
                      return;
                    }
                    updateAgentSessionModel(activeSession.sessionId, {
                      providerId,
                      modelId,
                      ...(model.variants[0] ? { variant: model.variants[0] } : {}),
                    });
                  }}
                />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Variant
                </p>
                <Combobox
                  value={activeSession.selectedModel?.variant ?? ""}
                  options={variantOptions}
                  placeholder={variantOptions.length > 0 ? "Select variant" : "No variants"}
                  disabled={variantOptions.length === 0}
                  onValueChange={(variant) => {
                    if (!activeSession.selectedModel) {
                      return;
                    }
                    updateAgentSessionModel(activeSession.sessionId, {
                      ...activeSession.selectedModel,
                      variant,
                    });
                  }}
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,1.1fr)_minmax(360px,1fr)]">
        <Card className="min-h-[540px]">
          <CardHeader>
            <CardTitle className="text-lg">Session Chat</CardTitle>
            <CardDescription>
              Agent conversation and orchestration events for the selected task/role.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex h-[calc(100%-5rem)] flex-col gap-3">
            <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/80 p-3">
              {!activeSession ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
                  Start a session to begin.
                </div>
              ) : null}

              {activeSession?.messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    message.role === "user"
                      ? "border-sky-200 bg-sky-50 text-slate-800"
                      : message.role === "assistant"
                        ? "border-slate-200 bg-white text-slate-800"
                        : message.role === "thinking"
                          ? "border-violet-200 bg-violet-50 text-violet-900"
                          : message.role === "tool"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-amber-200 bg-amber-50 text-amber-900",
                  )}
                >
                  <header className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {message.role === "thinking" ? "thinking" : message.role}
                  </header>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </article>
              ))}

              {activeSession?.draftAssistantText ? (
                <article className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <header className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    assistant (streaming)
                  </header>
                  <p className="whitespace-pre-wrap">{activeSession.draftAssistantText}</p>
                </article>
              ) : null}

              {activeSession?.status === "running" && !activeSession?.draftAssistantText ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
                  <LoaderCircle className="size-3.5 animate-spin text-slate-500" />
                  <Brain className="size-3.5 text-violet-600" />
                  Agent is thinking...
                </div>
              ) : null}
            </div>

            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void onSend();
              }}
            >
              <Textarea
                placeholder="Send instruction to agent (Enter to send, Shift+Enter for newline)"
                value={input}
                disabled={!activeSession || isSending}
                className="min-h-20 resize-none"
                onChange={(event) => setInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void onSend();
                  }
                }}
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={!activeSession || isSending || input.trim().length === 0}
                >
                  {isSending ? "Sending..." : "Send"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="grid min-h-[540px] gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pending Permissions</CardTitle>
              <CardDescription>Human-in-the-loop approval requests from OpenCode.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeSession?.pendingPermissions.length ? null : (
                <p className="text-sm text-slate-500">No pending permission requests.</p>
              )}
              {activeSession?.pendingPermissions.map((request) => (
                <div
                  key={request.requestId}
                  className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="text-sm font-medium text-slate-800">{request.permission}</p>
                  <p className="text-xs text-slate-600">
                    {request.patterns.join(", ") || "No pattern"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        void replyAgentPermission(
                          activeSession.sessionId,
                          request.requestId,
                          "once",
                        )
                      }
                    >
                      Allow Once
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void replyAgentPermission(
                          activeSession.sessionId,
                          request.requestId,
                          "always",
                        )
                      }
                    >
                      Always Allow
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        void replyAgentPermission(
                          activeSession.sessionId,
                          request.requestId,
                          "reject",
                        )
                      }
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Documents</CardTitle>
              <CardDescription>
                Current task artifacts for the active repository task.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <section className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Spec
                </h3>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  {specDoc.markdown.trim().length > 0 ? (
                    <MarkdownRenderer markdown={specDoc.markdown} variant="compact" />
                  ) : (
                    <p className="text-sm text-slate-500">No spec document yet.</p>
                  )}
                </div>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Implementation Plan
                </h3>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  {planDoc.markdown.trim().length > 0 ? (
                    <MarkdownRenderer markdown={planDoc.markdown} variant="compact" />
                  ) : (
                    <p className="text-sm text-slate-500">No implementation plan yet.</p>
                  )}
                </div>
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  QA Report
                </h3>
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  {qaDoc.markdown.trim().length > 0 ? (
                    <MarkdownRenderer markdown={qaDoc.markdown} variant="compact" />
                  ) : (
                    <p className="text-sm text-slate-500">No QA report yet.</p>
                  )}
                </div>
              </section>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pending Questions</CardTitle>
              <CardDescription>Answer required questions emitted by tool flows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeSession?.pendingQuestions.length ? null : (
                <p className="text-sm text-slate-500">No pending questions.</p>
              )}
              {activeSession?.pendingQuestions.map((request) => {
                const firstQuestion = request.questions[0];
                if (!firstQuestion) {
                  return null;
                }
                return (
                  <div
                    key={request.requestId}
                    className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <p className="text-sm font-medium text-slate-800">{firstQuestion.question}</p>
                    <div className="flex flex-wrap gap-2">
                      {firstQuestion.options.map((option) => (
                        <Button
                          key={option.label}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void answerAgentQuestion(activeSession.sessionId, request.requestId, [
                              [option.label],
                            ])
                          }
                        >
                          <CheckCircle2 className="size-3.5" />
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
