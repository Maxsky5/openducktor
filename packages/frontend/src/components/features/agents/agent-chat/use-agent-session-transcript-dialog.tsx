import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  useActiveWorkspace,
  useAgentOperations,
  useAgentSession,
} from "@/state/app-state-provider";
import { isTranscriptAgentSession } from "@/state/operations/agent-orchestrator/support/session-purpose";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";

export type OpenAgentSessionTranscriptRequest = {
  sessionId: string;
  source: RuntimeSessionTranscriptSource;
  title?: string;
  description?: string;
};

type AgentSessionTranscriptDialogContextValue = {
  openSessionTranscript: (request: OpenAgentSessionTranscriptRequest) => void;
  closeSessionTranscript: () => void;
};

const AgentSessionTranscriptDialogContext =
  createContext<AgentSessionTranscriptDialogContextValue | null>(null);

const DEFAULT_TITLE = "Conversation";
const DEFAULT_DESCRIPTION = "Read-only conversation.";

function AgentSessionTranscriptDialogProvider({ children }: PropsWithChildren): ReactElement {
  const activeWorkspace = useActiveWorkspace();
  const { removeAgentSession } = useAgentOperations();
  const [request, setRequest] = useState<OpenAgentSessionTranscriptRequest | null>(null);
  const sessionId = request?.sessionId ?? null;
  const activeTranscriptSession = useAgentSession(sessionId);
  const open = request !== null;

  const openSessionTranscript = useCallback((nextRequest: OpenAgentSessionTranscriptRequest) => {
    setRequest(nextRequest);
  }, []);

  const closeSessionTranscript = useCallback(() => {
    setRequest(null);
    if (sessionId && isTranscriptAgentSession(activeTranscriptSession)) {
      void removeAgentSession(sessionId);
    }
  }, [activeTranscriptSession, removeAgentSession, sessionId]);

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
        sessionId={sessionId}
        source={request?.source ?? null}
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeSessionTranscript();
          }
        }}
        title={request?.title ?? DEFAULT_TITLE}
        description={request?.description ?? DEFAULT_DESCRIPTION}
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
