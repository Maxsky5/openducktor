import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { TaskCard } from "@openducktor/contracts";
import { buildAgentSystemPrompt } from "@openducktor/core";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { host } from "../../host";
import {
  createRepoStaleGuard,
  fromPersistedSessionRecord,
  historyToChatMessages,
  normalizePersistedSelection,
  toBaseUrl,
} from "../support/utils";

type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

type SessionHistoryAdapter = Pick<OpencodeSdkAdapter, "loadSessionHistory">;

type CreateLoadAgentSessionsArgs = {
  activeRepo: string | null;
  adapter: SessionHistoryAdapter;
  repoEpochRef: MutableRefObject<number>;
  previousRepoRef: MutableRefObject<string | null>;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  setSessionsById: Dispatch<SetStateAction<Record<string, AgentSessionState>>>;
  taskRef: MutableRefObject<TaskCard[]>;
  updateSession: UpdateSession;
  loadSessionTodos: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<void>;
  loadSessionModelCatalog: (
    sessionId: string,
    baseUrl: string,
    workingDirectory: string,
  ) => Promise<void>;
};

export const createLoadAgentSessions = ({
  activeRepo,
  adapter,
  repoEpochRef,
  previousRepoRef,
  sessionsRef,
  setSessionsById,
  taskRef,
  updateSession,
  loadSessionTodos,
  loadSessionModelCatalog,
}: CreateLoadAgentSessionsArgs): ((taskId: string) => Promise<void>) => {
  return async (taskId: string): Promise<void> => {
    if (!activeRepo || taskId.trim().length === 0) {
      return;
    }

    const repoPath = activeRepo;
    const isStaleRepoOperation = createRepoStaleGuard({
      repoPath,
      repoEpochRef,
      previousRepoRef,
    });
    if (isStaleRepoOperation()) {
      return;
    }

    const warmSessionData = (
      targetSessionId: string,
      baseUrl: string,
      workingDirectory: string,
      externalSessionId: string,
    ): void => {
      void loadSessionTodos(targetSessionId, baseUrl, workingDirectory, externalSessionId).catch(
        () => undefined,
      );
      void loadSessionModelCatalog(targetSessionId, baseUrl, workingDirectory).catch(
        () => undefined,
      );
    };

    const buildPreludeMessages = async (
      record: Awaited<ReturnType<typeof host.agentSessionsList>>[number],
    ): Promise<AgentSessionState["messages"]> => {
      let preludeMessages: AgentSessionState["messages"] = [
        {
          id: `history:session-start:${record.sessionId}`,
          role: "system",
          content: `Session started (${record.role} - ${record.scenario})`,
          timestamp: record.startedAt,
        },
      ];

      const task = taskRef.current.find((entry) => entry.id === record.taskId);
      if (!task) {
        return preludeMessages;
      }

      const docs = await Promise.all([
        host
          .specGet(repoPath, record.taskId)
          .then((doc) => doc.markdown)
          .catch(() => ""),
        host
          .planGet(repoPath, record.taskId)
          .then((doc) => doc.markdown)
          .catch(() => ""),
        host
          .qaGetReport(repoPath, record.taskId)
          .then((doc) => doc.markdown)
          .catch(() => ""),
      ]).catch(() => null);
      if (!docs || isStaleRepoOperation()) {
        return preludeMessages;
      }

      const [specMarkdown, planMarkdown, qaMarkdown] = docs;
      const systemPrompt = buildAgentSystemPrompt({
        role: record.role,
        scenario: record.scenario,
        task: {
          taskId: task.id,
          title: task.title,
          issueType: task.issueType,
          status: task.status,
          qaRequired: task.aiReviewEnabled,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          specMarkdown,
          planMarkdown,
          latestQaReportMarkdown: qaMarkdown,
        },
      });
      preludeMessages = [
        ...preludeMessages,
        {
          id: `history:system-prompt:${record.sessionId}`,
          role: "system",
          content: `System prompt:\n\n${systemPrompt}`,
          timestamp: record.startedAt,
        },
      ];
      return preludeMessages;
    };

    const persisted = await host.agentSessionsList(repoPath, taskId);
    if (isStaleRepoOperation()) {
      return;
    }
    const existingIds = new Set(Object.keys(sessionsRef.current));
    const recordsToHydrate = persisted.filter((record) => !existingIds.has(record.sessionId));
    setSessionsById((current) => {
      if (isStaleRepoOperation()) {
        return current;
      }
      const next = { ...current };
      for (const record of persisted) {
        if (next[record.sessionId]) {
          continue;
        }
        next[record.sessionId] = fromPersistedSessionRecord(record);
      }
      sessionsRef.current = next;
      return next;
    });

    if (isStaleRepoOperation()) {
      return;
    }

    if (recordsToHydrate.length === 0) {
      const existingSessions = Object.values(sessionsRef.current).filter(
        (entry) => entry.taskId === taskId && !entry.modelCatalog && !entry.isLoadingModelCatalog,
      );
      for (const session of existingSessions) {
        if (!session.baseUrl || !session.workingDirectory) {
          continue;
        }
        warmSessionData(
          session.sessionId,
          session.baseUrl,
          session.workingDirectory,
          session.externalSessionId,
        );
      }
      return;
    }

    const requiresWorkspaceRuntime = recordsToHydrate.some(
      (record) => record.role === "spec" || record.role === "planner",
    );
    const workspaceRuntime = requiresWorkspaceRuntime
      ? await host.opencodeRepoRuntimeEnsure(repoPath).catch(() => null)
      : null;
    if (isStaleRepoOperation()) {
      return;
    }

    await Promise.all(
      recordsToHydrate.map(async (record) => {
        if (isStaleRepoOperation()) {
          return;
        }
        const baseUrl =
          (record.role === "spec" || record.role === "planner") && workspaceRuntime
            ? toBaseUrl(workspaceRuntime.port)
            : record.baseUrl;
        const workingDirectory =
          (record.role === "spec" || record.role === "planner") && workspaceRuntime
            ? workspaceRuntime.workingDirectory
            : record.workingDirectory;
        const existingSession = sessionsRef.current[record.sessionId];
        if (existingSession && existingSession.messages.length > 0) {
          if (isStaleRepoOperation()) {
            return;
          }
          updateSession(
            record.sessionId,
            (current) => ({
              ...current,
              baseUrl,
              workingDirectory,
            }),
            { persist: false },
          );
          warmSessionData(record.sessionId, baseUrl, workingDirectory, record.externalSessionId);
          return;
        }

        const historyPromise = adapter
          .loadSessionHistory({
            baseUrl,
            workingDirectory,
            externalSessionId: record.externalSessionId,
            limit: 2000,
          })
          .then((history) => ({ ok: true as const, history }))
          .catch(() => ({ ok: false as const }));

        const preludeMessages = await buildPreludeMessages(record);
        if (isStaleRepoOperation()) {
          return;
        }

        const historyResult = await historyPromise;
        if (isStaleRepoOperation()) {
          return;
        }

        if (!historyResult.ok) {
          warmSessionData(record.sessionId, baseUrl, workingDirectory, record.externalSessionId);
          return;
        }

        updateSession(
          record.sessionId,
          (current) => ({
            ...current,
            baseUrl,
            workingDirectory,
            messages: [
              ...preludeMessages,
              ...historyToChatMessages(historyResult.history, {
                role: record.role,
                selectedModel: normalizePersistedSelection(record.selectedModel),
              }),
            ],
          }),
          { persist: false },
        );
        warmSessionData(record.sessionId, baseUrl, workingDirectory, record.externalSessionId);
      }),
    );
  };
};
