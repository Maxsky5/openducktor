import { errorMessage } from "@/lib/errors";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { OpencodeSdkAdapter } from "@openblueprint/adapters-opencode-sdk";
import type { RunSummary, TaskCard } from "@openblueprint/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  type AgentRole,
  type AgentScenario,
  buildAgentSystemPrompt,
} from "@openblueprint/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { host } from "./host";

type UseAgentOrchestratorOperationsArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  runs: RunSummary[];
  refreshTaskData: (repoPath: string) => Promise<void>;
};

type UseAgentOrchestratorOperationsResult = {
  sessions: AgentSessionState[];
  startAgentSession: (input: {
    taskId: string;
    role: AgentRole;
    scenario?: AgentScenario;
    sendKickoff?: boolean;
  }) => Promise<string>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
  stopAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  replyAgentPermission: (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (sessionId: string, requestId: string, answers: string[][]) => Promise<void>;
};

type RuntimeInfo = {
  runtimeId: string | null;
  runId: string | null;
  baseUrl: string;
  workingDirectory: string;
};

const toBaseUrl = (port: number): string => `http://127.0.0.1:${port}`;

const runningStates = new Set(["starting", "running", "blocked", "awaiting_done_confirmation"]);

const now = (): string => new Date().toISOString();

const inferScenario = (
  role: AgentRole,
  task: TaskCard,
  docs: {
    specMarkdown: string;
    planMarkdown: string;
    qaMarkdown: string;
  },
): AgentScenario => {
  if (role === "spec") {
    return docs.specMarkdown.trim().length > 0 || task.status === "spec_ready"
      ? "spec_revision"
      : "spec_initial";
  }
  if (role === "planner") {
    return docs.planMarkdown.trim().length > 0 ? "planner_revision" : "planner_initial";
  }
  if (role === "qa") {
    return "qa_review";
  }

  if (docs.qaMarkdown.trim().length > 0 && task.status === "in_progress") {
    return "build_after_qa_rejected";
  }

  if (task.status === "in_progress" && docs.qaMarkdown.trim().length === 0) {
    return "build_after_human_request_changes";
  }

  return "build_implementation_start";
};

const kickoffPrompt = (role: AgentRole, scenario: AgentScenario): string => {
  if (role === "spec") {
    return scenario === "spec_revision"
      ? "Revise the current specification and call set_spec with the updated markdown."
      : "Write the initial specification and call set_spec with complete markdown.";
  }
  if (role === "planner") {
    return scenario === "planner_revision"
      ? "Revise the current implementation plan and call set_plan with the updated markdown."
      : "Create the initial implementation plan and call set_plan with concrete execution steps.";
  }
  if (role === "qa") {
    return "Perform QA review now and call qa_approved or qa_rejected exactly once with a complete report.";
  }
  if (scenario === "build_after_qa_rejected") {
    return "Address all QA rejection findings and call build_completed with a concise rework summary.";
  }
  if (scenario === "build_after_human_request_changes") {
    return "Apply all human-requested changes and call build_completed with a concise summary.";
  }
  return "Start implementation now and use build_blocked/build_resumed/build_completed as progress changes.";
};

const pickDefaultModel = (catalog: AgentModelCatalog): AgentModelSelection | null => {
  if (catalog.models.length === 0) {
    return null;
  }

  for (const model of catalog.models) {
    const providerDefault = catalog.defaultModelsByProvider[model.providerId];
    if (providerDefault && providerDefault === model.modelId) {
      return {
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
      };
    }
  }

  const first = catalog.models[0];
  if (!first) {
    return null;
  }

  return {
    providerId: first.providerId,
    modelId: first.modelId,
    ...(first.variants[0] ? { variant: first.variants[0] } : {}),
  };
};

const normalizeSelectionForCatalog = (
  catalog: AgentModelCatalog,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }

  const model = catalog.models.find(
    (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId,
  );
  if (!model) {
    return null;
  }

  const hasVariant = Boolean(selection.variant && model.variants.includes(selection.variant));
  const hasAgent = Boolean(
    selection.opencodeAgent &&
      catalog.agents.some((agent) => agent.name === selection.opencodeAgent),
  );

  return {
    providerId: model.providerId,
    modelId: model.modelId,
    ...(hasVariant
      ? { variant: selection.variant }
      : model.variants[0]
        ? { variant: model.variants[0] }
        : {}),
    ...(hasAgent ? { opencodeAgent: selection.opencodeAgent } : {}),
  };
};

const upsertMessage = (
  messages: AgentChatMessage[],
  message: AgentChatMessage,
): AgentChatMessage[] => {
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) {
    return [...messages, message];
  }

  const next = [...messages];
  next[index] = {
    ...next[index],
    ...message,
  };
  return next;
};

const formatToolContent = (part: {
  tool: string;
  status: "pending" | "running" | "completed" | "error";
  title?: string;
  output?: string;
  error?: string;
}): string => {
  const title = part.title ? ` (${part.title})` : "";
  if (part.status === "completed") {
    return `Tool ${part.tool}${title} completed${part.output ? `\n\n${part.output}` : ""}`;
  }
  if (part.status === "error") {
    return `Tool ${part.tool}${title} failed${part.error ? `\n\n${part.error}` : ""}`;
  }
  if (part.status === "running") {
    return `Tool ${part.tool}${title} running...`;
  }
  return `Tool ${part.tool}${title} queued...`;
};

export function useAgentOrchestratorOperations({
  activeRepo,
  tasks,
  runs,
  refreshTaskData,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const [sessionsById, setSessionsById] = useState<Record<string, AgentSessionState>>({});
  const sessionsRef = useRef<Record<string, AgentSessionState>>({});
  const taskRef = useRef<TaskCard[]>(tasks);
  const runsRef = useRef(runs);
  const unsubscribersRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    sessionsRef.current = sessionsById;
  }, [sessionsById]);

  useEffect(() => {
    taskRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  const adapter = useMemo(() => {
    return new OpencodeSdkAdapter({
      setSpec: async (repoPath, taskId, markdown) => host.setSpec({ repoPath, taskId, markdown }),
      setPlan: async (repoPath, taskId, markdown, subtasks) =>
        host.setPlan({
          repoPath,
          taskId,
          markdown,
          ...(subtasks ? { subtasks } : {}),
        }),
      buildBlocked: async (repoPath, taskId, reason) => host.buildBlocked(repoPath, taskId, reason),
      buildResumed: async (repoPath, taskId) => host.buildResumed(repoPath, taskId),
      buildCompleted: async (repoPath, taskId, summary) =>
        host.buildCompleted(repoPath, taskId, summary),
      qaApproved: async (repoPath, taskId, reportMarkdown) =>
        host.qaApproved(repoPath, taskId, reportMarkdown),
      qaRejected: async (repoPath, taskId, reportMarkdown) =>
        host.qaRejected(repoPath, taskId, reportMarkdown),
    });
  }, []);

  const updateSession = useCallback(
    (sessionId: string, updater: (current: AgentSessionState) => AgentSessionState): void => {
      setSessionsById((current) => {
        const entry = current[sessionId];
        if (!entry) {
          return current;
        }
        return {
          ...current,
          [sessionId]: updater(entry),
        };
      });
    },
    [],
  );

  const attachSessionListener = useCallback(
    (repoPath: string, sessionId: string): void => {
      const unsubscribe = adapter.subscribeEvents(sessionId, (event) => {
        if (event.type === "session_started") {
          updateSession(sessionId, (current) => ({
            ...current,
            status: "running",
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                role: "system",
                content: event.message,
                timestamp: event.timestamp,
              },
            ],
          }));
          return;
        }

        if (event.type === "assistant_delta") {
          updateSession(sessionId, (current) => ({
            ...current,
            status: "running",
            draftAssistantText: `${current.draftAssistantText}${event.delta}`,
          }));
          return;
        }

        if (event.type === "assistant_part") {
          const part = event.part;
          if (part.kind === "text") {
            if (!part.synthetic) {
              updateSession(sessionId, (current) => ({
                ...current,
                status: "running",
                draftAssistantText: part.text,
              }));
            }
            return;
          }

          if (part.kind === "reasoning") {
            updateSession(sessionId, (current) => ({
              ...current,
              status: "running",
              messages: upsertMessage(current.messages, {
                id: `thinking:${part.partId}`,
                role: "thinking",
                content: part.text,
                timestamp: event.timestamp,
              }),
            }));
            return;
          }

          if (part.kind === "tool") {
            updateSession(sessionId, (current) => ({
              ...current,
              status: "running",
              messages: upsertMessage(current.messages, {
                id: `tool:${part.partId}`,
                role: "tool",
                content: formatToolContent(part),
                timestamp: event.timestamp,
              }),
            }));
            return;
          }

          if (part.kind === "step") {
            updateSession(sessionId, (current) => ({
              ...current,
              status: "running",
              messages: upsertMessage(current.messages, {
                id: `step:${part.partId}`,
                role: "system",
                content:
                  part.phase === "start"
                    ? "Agent step started"
                    : `Agent step finished${part.reason ? ` (${part.reason})` : ""}`,
                timestamp: event.timestamp,
              }),
            }));
            return;
          }

          if (part.kind === "subtask") {
            updateSession(sessionId, (current) => ({
              ...current,
              status: "running",
              messages: upsertMessage(current.messages, {
                id: `subtask:${part.partId}`,
                role: "system",
                content: `Subtask (${part.agent}): ${part.description}`,
                timestamp: event.timestamp,
              }),
            }));
          }
          return;
        }

        if (event.type === "assistant_message") {
          updateSession(sessionId, (current) => ({
            ...current,
            draftAssistantText: "",
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: event.message,
                timestamp: event.timestamp,
              },
            ],
          }));
          return;
        }

        if (event.type === "tool_call") {
          updateSession(sessionId, (current) => ({
            ...current,
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                role: "system",
                content: `Workflow tool call: ${event.call.tool}`,
                timestamp: event.timestamp,
              },
            ],
          }));
          return;
        }

        if (event.type === "tool_result") {
          updateSession(sessionId, (current) => ({
            ...current,
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                role: "system",
                content: `${event.tool}: ${event.success ? "success" : "error"} - ${event.message}`,
                timestamp: event.timestamp,
              },
            ],
          }));
          if (event.success) {
            void refreshTaskData(repoPath).catch(() => undefined);
          }
          return;
        }

        if (event.type === "session_status") {
          const status = event.status;
          if (status.type === "busy") {
            updateSession(sessionId, (current) => ({
              ...current,
              status: "running",
            }));
            return;
          }
          if (status.type === "retry") {
            updateSession(sessionId, (current) => ({
              ...current,
              status: "running",
              messages: upsertMessage(current.messages, {
                id: `retry:${status.attempt}`,
                role: "system",
                content: `Retry ${status.attempt}: ${status.message}`,
                timestamp: event.timestamp,
              }),
            }));
            return;
          }
          updateSession(sessionId, (current) => ({
            ...current,
            status: "idle",
            draftAssistantText: "",
          }));
          return;
        }

        if (event.type === "permission_required") {
          updateSession(sessionId, (current) => ({
            ...current,
            pendingPermissions: [
              ...current.pendingPermissions.filter((entry) => entry.requestId !== event.requestId),
              {
                requestId: event.requestId,
                permission: event.permission,
                patterns: event.patterns,
                ...(event.metadata ? { metadata: event.metadata } : {}),
              },
            ],
          }));
          return;
        }

        if (event.type === "question_required") {
          updateSession(sessionId, (current) => ({
            ...current,
            pendingQuestions: [
              ...current.pendingQuestions.filter((entry) => entry.requestId !== event.requestId),
              {
                requestId: event.requestId,
                questions: event.questions,
              },
            ],
          }));
          return;
        }

        if (event.type === "session_error") {
          updateSession(sessionId, (current) => ({
            ...current,
            status: "error",
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                role: "system",
                content: `Session error: ${event.message}`,
                timestamp: event.timestamp,
              },
            ],
          }));
          return;
        }

        if (event.type === "session_idle") {
          updateSession(sessionId, (current) => ({
            ...current,
            status: "idle",
            draftAssistantText: "",
          }));
          return;
        }

        if (event.type === "session_finished") {
          updateSession(sessionId, (current) => ({
            ...current,
            status: "stopped",
            draftAssistantText: "",
          }));
        }
      });

      unsubscribersRef.current.set(sessionId, unsubscribe);
    },
    [adapter, refreshTaskData, updateSession],
  );

  const loadTaskDocuments = useCallback(async (repoPath: string, taskId: string) => {
    const [spec, plan, qa] = await Promise.all([
      host
        .specGet(repoPath, taskId)
        .then((doc) => doc.markdown)
        .catch(() => ""),
      host
        .planGet(repoPath, taskId)
        .then((doc) => doc.markdown)
        .catch(() => ""),
      host
        .qaGetReport(repoPath, taskId)
        .then((doc) => doc.markdown)
        .catch(() => ""),
    ]);

    return {
      specMarkdown: spec,
      planMarkdown: plan,
      qaMarkdown: qa,
    };
  }, []);

  const loadRepoDefaultModel = useCallback(
    async (repoPath: string, role: AgentRole): Promise<AgentModelSelection | null> => {
      const config = await host.workspaceGetRepoConfig(repoPath);
      const roleDefault = config.agentDefaults[role];
      if (!roleDefault) {
        return null;
      }

      return {
        providerId: roleDefault.providerId,
        modelId: roleDefault.modelId,
        ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
        ...(roleDefault.opencodeAgent ? { opencodeAgent: roleDefault.opencodeAgent } : {}),
      };
    },
    [],
  );

  const ensureRuntime = useCallback(
    async (repoPath: string, taskId: string, role: AgentRole): Promise<RuntimeInfo> => {
      if (role === "build") {
        let run = runsRef.current.find(
          (entry) => entry.taskId === taskId && runningStates.has(entry.state),
        );
        if (!run) {
          run = await host.buildStart(repoPath, taskId);
          await refreshTaskData(repoPath);
        }
        return {
          runtimeId: null,
          runId: run.runId,
          baseUrl: toBaseUrl(run.port),
          workingDirectory: run.worktreePath,
        };
      }

      const runtime = await host.opencodeRepoRuntimeEnsure(repoPath);
      return {
        runtimeId: runtime.runtimeId,
        runId: null,
        baseUrl: toBaseUrl(runtime.port),
        workingDirectory: runtime.workingDirectory,
      };
    },
    [refreshTaskData],
  );

  const sendAgentMessage = useCallback(
    async (sessionId: string, content: string): Promise<void> => {
      const trimmed = content.trim();
      if (!trimmed) {
        return;
      }

      const session = sessionsRef.current[sessionId];
      const selectedModel = session?.selectedModel ?? undefined;

      updateSession(sessionId, (current) => ({
        ...current,
        status: "running",
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            role: "user",
            content: trimmed,
            timestamp: now(),
          },
        ],
      }));

      try {
        await adapter.sendUserMessage({
          sessionId,
          content: trimmed,
          ...(selectedModel ? { model: selectedModel } : {}),
        });
      } catch (error) {
        updateSession(sessionId, (current) => ({
          ...current,
          status: "error",
          messages: [
            ...current.messages,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Failed to send message: ${errorMessage(error)}`,
              timestamp: now(),
            },
          ],
        }));
        throw error;
      }
    },
    [adapter, updateSession],
  );

  const startAgentSession = useCallback(
    async ({
      taskId,
      role,
      scenario,
      sendKickoff = false,
    }: {
      taskId: string;
      role: AgentRole;
      scenario?: AgentScenario;
      sendKickoff?: boolean;
    }): Promise<string> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      const existing = Object.values(sessionsRef.current).find(
        (session) =>
          session.taskId === taskId &&
          session.role === role &&
          session.status !== "stopped" &&
          session.status !== "error",
      );
      if (existing) {
        return existing.sessionId;
      }

      const task = taskRef.current.find((entry) => entry.id === taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const docs = await loadTaskDocuments(activeRepo, taskId);
      const resolvedScenario = scenario ?? inferScenario(role, task, docs);
      const runtime = await ensureRuntime(activeRepo, taskId, role);
      const defaultModelSelection = await loadRepoDefaultModel(activeRepo, role).catch(() => null);
      const systemPrompt = buildAgentSystemPrompt({
        role,
        scenario: resolvedScenario,
        task: {
          taskId: task.id,
          title: task.title,
          issueType: task.issueType,
          status: task.status,
          qaRequired: task.aiReviewEnabled,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          specMarkdown: docs.specMarkdown,
          planMarkdown: docs.planMarkdown,
          latestQaReportMarkdown: docs.qaMarkdown,
        },
      });

      const summary = await adapter.startSession({
        repoPath: activeRepo,
        workingDirectory: runtime.workingDirectory,
        taskId,
        role,
        scenario: resolvedScenario,
        systemPrompt,
        baseUrl: runtime.baseUrl,
      });

      setSessionsById((current) => ({
        ...current,
        [summary.sessionId]: {
          sessionId: summary.sessionId,
          taskId,
          role,
          scenario: resolvedScenario,
          status: "idle",
          startedAt: summary.startedAt,
          runtimeId: runtime.runtimeId,
          runId: runtime.runId,
          baseUrl: runtime.baseUrl,
          workingDirectory: runtime.workingDirectory,
          messages: [
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Session started (${role} - ${resolvedScenario})`,
              timestamp: summary.startedAt,
            },
          ],
          draftAssistantText: "",
          pendingPermissions: [],
          pendingQuestions: [],
          modelCatalog: null,
          selectedModel: defaultModelSelection,
          isLoadingModelCatalog: true,
        },
      }));

      attachSessionListener(activeRepo, summary.sessionId);

      void adapter
        .listAvailableModels({
          baseUrl: runtime.baseUrl,
          workingDirectory: runtime.workingDirectory,
        })
        .then((catalog) => {
          updateSession(summary.sessionId, (current) => ({
            ...current,
            modelCatalog: catalog,
            selectedModel:
              normalizeSelectionForCatalog(catalog, current.selectedModel) ??
              pickDefaultModel(catalog),
            isLoadingModelCatalog: false,
          }));
        })
        .catch((error) => {
          updateSession(summary.sessionId, (current) => ({
            ...current,
            isLoadingModelCatalog: false,
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                role: "system",
                content: `Model catalog unavailable: ${errorMessage(error)}`,
                timestamp: now(),
              },
            ],
          }));
        });

      if (sendKickoff) {
        await sendAgentMessage(summary.sessionId, kickoffPrompt(role, resolvedScenario));
        await refreshTaskData(activeRepo);
      }

      return summary.sessionId;
    },
    [
      activeRepo,
      adapter,
      attachSessionListener,
      ensureRuntime,
      loadRepoDefaultModel,
      loadTaskDocuments,
      refreshTaskData,
      sendAgentMessage,
      updateSession,
    ],
  );

  const stopAgentSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const session = sessionsRef.current[sessionId];
      if (!session) {
        return;
      }

      const unsubscribe = unsubscribersRef.current.get(sessionId);
      unsubscribe?.();
      unsubscribersRef.current.delete(sessionId);

      await adapter.stopSession(sessionId);

      updateSession(sessionId, (current) => ({
        ...current,
        status: "stopped",
        draftAssistantText: "",
      }));
    },
    [adapter, updateSession],
  );

  const updateAgentSessionModel = useCallback(
    (sessionId: string, selection: AgentModelSelection | null): void => {
      updateSession(sessionId, (current) => ({
        ...current,
        selectedModel: selection,
      }));
    },
    [updateSession],
  );

  const replyAgentPermission = useCallback(
    async (
      sessionId: string,
      requestId: string,
      reply: "once" | "always" | "reject",
      message?: string,
    ): Promise<void> => {
      await adapter.replyPermission({
        sessionId,
        requestId,
        reply,
        ...(message ? { message } : {}),
      });

      updateSession(sessionId, (current) => ({
        ...current,
        pendingPermissions: current.pendingPermissions.filter(
          (entry) => entry.requestId !== requestId,
        ),
      }));
    },
    [adapter, updateSession],
  );

  const answerAgentQuestion = useCallback(
    async (sessionId: string, requestId: string, answers: string[][]): Promise<void> => {
      await adapter.replyQuestion({ sessionId, requestId, answers });
      updateSession(sessionId, (current) => ({
        ...current,
        pendingQuestions: current.pendingQuestions.filter((entry) => entry.requestId !== requestId),
      }));
    },
    [adapter, updateSession],
  );

  useEffect(() => {
    return () => {
      const unsubs = [...unsubscribersRef.current.values()];
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
      unsubscribersRef.current.clear();
    };
  }, []);

  const sessions = useMemo(
    () =>
      Object.values(sessionsById).sort((a, b) =>
        a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0,
      ),
    [sessionsById],
  );

  return {
    sessions,
    startAgentSession: async (input) => {
      try {
        return await startAgentSession(input);
      } catch (error) {
        toast.error("Failed to start agent session", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    replyAgentPermission,
    answerAgentQuestion,
  };
}
