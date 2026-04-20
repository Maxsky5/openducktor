import type { AgentSessionRecord } from "@openducktor/contracts";
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
import { useActiveWorkspace } from "@/state/app-state-provider";
import { host } from "@/state/operations/host";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";

export type OpenAgentSessionTranscriptRequest = {
  taskId: string;
  sessionId: string;
  title?: string;
  description?: string;
};

type AgentSessionTranscriptDialogContextValue = {
  openSessionTranscript: (request: OpenAgentSessionTranscriptRequest) => void;
  closeSessionTranscript: () => void;
};

const AgentSessionTranscriptDialogContext =
  createContext<AgentSessionTranscriptDialogContextValue | null>(null);

const DEFAULT_TITLE = "Session transcript";

const buildDefaultDescription = (sessionId: string): string =>
  `Read-only transcript for session ${sessionId}.`;

export function AgentSessionTranscriptDialogProvider({
  children,
}: PropsWithChildren): ReactElement {
  const activeWorkspace = useActiveWorkspace();
  const [request, setRequest] = useState<OpenAgentSessionTranscriptRequest | null>(null);
  const repoPath = activeWorkspace?.repoPath ?? null;
  const taskId = request?.taskId ?? "";
  const sessionId = request?.sessionId ?? null;
  const open = request !== null;

  const { data: persistedRecords } = useQuery<AgentSessionRecord[]>({
    queryKey: ["agent-session-transcript-dialog", repoPath, taskId],
    enabled: open && repoPath !== null && taskId.length > 0,
    queryFn: async (): Promise<AgentSessionRecord[]> => {
      if (!repoPath || taskId.length === 0) {
        throw new Error("Cannot load transcript session records without an active repository.");
      }
      return host.agentSessionsList(repoPath, taskId);
    },
    staleTime: 30_000,
  });

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
        taskId={taskId}
        sessionId={sessionId}
        {...(persistedRecords ? { persistedRecords } : {})}
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeSessionTranscript();
          }
        }}
        title={request?.title ?? DEFAULT_TITLE}
        description={
          request?.description ??
          (sessionId ? buildDefaultDescription(sessionId) : "Read-only session transcript.")
        }
      />
    </AgentSessionTranscriptDialogContext.Provider>
  );
}

export const useOptionalAgentSessionTranscriptDialog =
  (): AgentSessionTranscriptDialogContextValue | null => {
    return useContext(AgentSessionTranscriptDialogContext);
  };

export const useAgentSessionTranscriptDialog = (): AgentSessionTranscriptDialogContextValue => {
  const context = useOptionalAgentSessionTranscriptDialog();
  if (!context) {
    throw new Error(
      "useAgentSessionTranscriptDialog must be used within AgentSessionTranscriptDialogProvider.",
    );
  }
  return context;
};
