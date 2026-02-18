import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { OpencodeSdkAdapter } from "@openblueprint/adapters-opencode-sdk";
import type { RunSummary, TaskCard } from "@openblueprint/contracts";
import { type AgentRole, type AgentScenario, buildAgentSystemPrompt } from "@openblueprint/core";
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
  }) => Promise<string>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
  stopAgentSession: (sessionId: string) => Promise<void>;
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

const SESSION_AUTO_PROMPT: Record<AgentRole, Record<AgentScenario, string>> = {
  spec: {
    spec_initial: "Create the first complete specification revision and emit set_spec when ready.",
    spec_revision:
      "Revise the specification based on available context and emit set_spec with the updated markdown.",
    planner_initial:
      "Create the first complete specification revision and emit set_spec when ready.",
    planner_revision:
      "Revise the specification based on available context and emit set_spec with the updated markdown.",
    build_implementation_start:
      "Create the first complete specification revision and emit set_spec when ready.",
    build_after_qa_rejected:
      "Create the first complete specification revision and emit set_spec when ready.",
    build_after_human_request_changes:
      "Create the first complete specification revision and emit set_spec when ready.",
    qa_review: "Create the first complete specification revision and emit set_spec when ready.",
  },
  planner: {
    planner_initial:
      "Create the first implementation plan now and emit set_plan with concrete execution steps.",
    planner_revision:
      "Revise the implementation plan now and emit set_plan with updated scope and sequencing.",
    spec_initial:
      "Create the first implementation plan now and emit set_plan with concrete execution steps.",
    spec_revision:
      "Create the first implementation plan now and emit set_plan with concrete execution steps.",
    build_implementation_start:
      "Create the first implementation plan now and emit set_plan with concrete execution steps.",
    build_after_qa_rejected:
      "Create the first implementation plan now and emit set_plan with concrete execution steps.",
    build_after_human_request_changes:
      "Create the first implementation plan now and emit set_plan with concrete execution steps.",
    qa_review:
      "Create the first implementation plan now and emit set_plan with concrete execution steps.",
  },
  build: {
    build_implementation_start:
      "Start implementing now. Use build_blocked/build_completed as the task progresses.",
    build_after_qa_rejected:
      "Address the QA rejection findings now, then emit build_completed with a rework summary.",
    build_after_human_request_changes:
      "Apply requested human review changes now, then emit build_completed with an updated summary.",
    spec_initial:
      "Start implementing now. Use build_blocked/build_completed as the task progresses.",
    spec_revision:
      "Start implementing now. Use build_blocked/build_completed as the task progresses.",
    planner_initial:
      "Start implementing now. Use build_blocked/build_completed as the task progresses.",
    planner_revision:
      "Start implementing now. Use build_blocked/build_completed as the task progresses.",
    qa_review: "Start implementing now. Use build_blocked/build_completed as the task progresses.",
  },
  qa: {
    qa_review:
      "Run QA review now. Emit qa_approved or qa_rejected with a complete markdown report.",
    spec_initial:
      "Run QA review now. Emit qa_approved or qa_rejected with a complete markdown report.",
    spec_revision:
      "Run QA review now. Emit qa_approved or qa_rejected with a complete markdown report.",
    planner_initial:
      "Run QA review now. Emit qa_approved or qa_rejected with a complete markdown report.",
    planner_revision:
      "Run QA review now. Emit qa_approved or qa_rejected with a complete markdown report.",
    build_implementation_start:
      "Run QA review now. Emit qa_approved or qa_rejected with a complete markdown report.",
    build_after_qa_rejected:
      "Run QA review now. Emit qa_approved or qa_rejected with a complete markdown report.",
    build_after_human_request_changes:
      "Run QA review now. Emit qa_approved or qa_rejected with a complete markdown report.",
  },
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
        if (event.type === "assistant_delta") {
          updateSession(sessionId, (current) => ({
            ...current,
            draftAssistantText: `${current.draftAssistantText}${event.delta}`,
          }));
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
                content: `Tool call: ${event.call.tool}`,
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

      const runtime = await host.opencodeRuntimeStart(
        repoPath,
        taskId,
        role as "spec" | "planner" | "qa",
      );
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
        await adapter.sendUserMessage({ sessionId, content: trimmed });
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
    }: {
      taskId: string;
      role: AgentRole;
      scenario?: AgentScenario;
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
          status: summary.status,
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
        },
      }));

      attachSessionListener(activeRepo, summary.sessionId);

      const kickoff = SESSION_AUTO_PROMPT[role][resolvedScenario];
      await sendAgentMessage(summary.sessionId, kickoff);
      await refreshTaskData(activeRepo);

      return summary.sessionId;
    },
    [
      activeRepo,
      adapter,
      attachSessionListener,
      ensureRuntime,
      loadTaskDocuments,
      refreshTaskData,
      sendAgentMessage,
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
      if (session.runtimeId) {
        await host.opencodeRuntimeStop(session.runtimeId).catch(() => ({ ok: false }));
      }

      updateSession(sessionId, (current) => ({
        ...current,
        status: "stopped",
        draftAssistantText: "",
      }));
    },
    [adapter, updateSession],
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
    replyAgentPermission,
    answerAgentQuestion,
  };
}
