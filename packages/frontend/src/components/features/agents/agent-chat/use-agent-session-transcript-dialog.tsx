import { type PropsWithChildren, type ReactElement, useCallback, useMemo, useState } from "react";
import { useActiveWorkspace } from "@/state/app-state-provider";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";
import {
  AgentSessionTranscriptDialogContext,
  type OpenAgentSessionTranscriptRequest,
} from "./agent-session-transcript-dialog-context";

const DEFAULT_TITLE = "Conversation";
const DEFAULT_DESCRIPTION = "Read-only conversation.";

function AgentSessionTranscriptDialogProvider({ children }: PropsWithChildren): ReactElement {
  const activeWorkspace = useActiveWorkspace();
  const [request, setRequest] = useState<OpenAgentSessionTranscriptRequest | null>(null);
  const externalSessionId = request?.externalSessionId ?? null;
  const open = request !== null;

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
        externalSessionId={externalSessionId}
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
