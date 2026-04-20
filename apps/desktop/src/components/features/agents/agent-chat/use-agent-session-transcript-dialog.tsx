import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useActiveWorkspace, useTasksState } from "@/state/app-state-provider";
import { host } from "@/state/operations/host";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";

export type OpenAgentSessionTranscriptRequest = {
  taskId: string;
  sessionId: string;
  title?: string;
  description?: string;
  fallbackSession?: {
    role: AgentRole;
    runtimeKind: RuntimeKind;
    workingDirectory: string;
  };
};

type AgentSessionTranscriptDialogContextValue = {
  openSessionTranscript: (request: OpenAgentSessionTranscriptRequest) => void;
  closeSessionTranscript: () => void;
};

const AgentSessionTranscriptDialogContext =
  createContext<AgentSessionTranscriptDialogContextValue | null>(null);

const DEFAULT_TITLE = "Conversation";

const buildDefaultDescription = (): string => "Read-only conversation.";

function AgentSessionTranscriptDialogProvider({ children }: PropsWithChildren): ReactElement {
  const activeWorkspace = useActiveWorkspace();
  const { tasks } = useTasksState();
  const [request, setRequest] = useState<OpenAgentSessionTranscriptRequest | null>(null);
  const repoPath = activeWorkspace?.repoPath ?? null;
  const sessionId = request?.sessionId ?? null;
  const open = request !== null;
  const candidateTaskIds = useMemo(() => {
    const ids = new Set<string>();
    const requestedTaskId = request?.taskId?.trim() ?? "";
    if (requestedTaskId.length > 0) {
      ids.add(requestedTaskId);
    }
    for (const task of tasks) {
      if (task.id.trim().length > 0) {
        ids.add(task.id);
      }
    }
    return Array.from(ids).sort();
  }, [request?.taskId, tasks]);

  const {
    data: sessionRecordsByTaskId,
    isPending,
    isFetching,
  } = useQuery<Record<string, AgentSessionRecord[]>>({
    queryKey: ["agent-session-dialog", "session-records", repoPath, sessionId, candidateTaskIds],
    enabled: open && repoPath !== null && sessionId !== null && candidateTaskIds.length > 0,
    queryFn: async (): Promise<Record<string, AgentSessionRecord[]>> => {
      if (!repoPath || !sessionId || candidateTaskIds.length === 0) {
        throw new Error("Cannot load session records without repository and session context.");
      }
      return host.agentSessionsListBulk(repoPath, candidateTaskIds);
    },
    staleTime: 0,
  });
  const resolvedTaskId = useMemo(() => {
    const requestedTaskId = request?.taskId?.trim() ?? "";
    if (!sessionId) {
      return requestedTaskId;
    }

    const localTask = tasks.find((task) =>
      (task.agentSessions ?? []).some((record) => record.sessionId === sessionId),
    );
    if (localTask) {
      return localTask.id;
    }

    if (sessionRecordsByTaskId) {
      for (const [taskId, records] of Object.entries(sessionRecordsByTaskId)) {
        if (records.some((record) => record.sessionId === sessionId)) {
          return taskId;
        }
      }
    }

    return requestedTaskId;
  }, [request?.taskId, sessionId, sessionRecordsByTaskId, tasks]);
  const persistedRecords = useMemo(() => {
    if (!resolvedTaskId) {
      return undefined;
    }
    return sessionRecordsByTaskId?.[resolvedTaskId];
  }, [resolvedTaskId, sessionRecordsByTaskId]);
  const isResolvingRequestedSession = open && (isPending || isFetching);

  const openSessionTranscript = useCallback((nextRequest: OpenAgentSessionTranscriptRequest) => {
    setRequest(nextRequest);
  }, []);

  const closeSessionTranscript = useCallback(() => {
    setRequest(null);
  }, []);

  const contextValue = useMemo(
    () => ({
      openSessionTranscript,
      closeSessionTranscript,
    }),
    [closeSessionTranscript, openSessionTranscript],
  );

  return (
    <AgentSessionTranscriptDialogContext.Provider value={contextValue}>
      {children}
      <AgentSessionTranscriptDialog
        activeWorkspace={activeWorkspace}
        taskId={resolvedTaskId}
        sessionId={sessionId}
        {...(persistedRecords ? { persistedRecords } : {})}
        {...(request?.fallbackSession ? { fallbackSession: request.fallbackSession } : {})}
        isResolvingRequestedSession={isResolvingRequestedSession}
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeSessionTranscript();
          }
        }}
        title={request?.title ?? DEFAULT_TITLE}
        description={request?.description ?? buildDefaultDescription()}
      />
    </AgentSessionTranscriptDialogContext.Provider>
  );
}

export function AgentSessionTranscriptDialogHost({ children }: PropsWithChildren): ReactElement {
  return <AgentSessionTranscriptDialogProvider>{children}</AgentSessionTranscriptDialogProvider>;
}

export const useOptionalAgentSessionTranscriptDialog =
  (): AgentSessionTranscriptDialogContextValue | null => {
    return useContext(AgentSessionTranscriptDialogContext);
  };

export const useAgentSessionTranscriptDialog = (): AgentSessionTranscriptDialogContextValue => {
  const context = useOptionalAgentSessionTranscriptDialog();
  if (!context) {
    throw new Error(
      "useAgentSessionTranscriptDialog must be used within AgentSessionTranscriptDialogHost.",
    );
  }
  return context;
};
