import { useTaskExecutionFilePreviewController } from "../file-preview/use-task-execution-file-preview-controller";
import {
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useActiveWorkspace } from "@/state/app-state-provider";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";
import {
  AgentSessionTranscriptDialogContext,
  type OpenAgentSessionTranscriptRequest,
} from "./agent-session-transcript-dialog-context";

const DEFAULT_TITLE = "Conversation";
const DEFAULT_DESCRIPTION = "Read-only conversation.";

function AgentSessionTranscriptDialogProvider({ children }: PropsWithChildren): ReactElement {
  const preview = useTaskExecutionFilePreviewController();
  const { requestContextTransition } = preview;
  const activeWorkspace = useActiveWorkspace();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const [request, setRequest] = useState<OpenAgentSessionTranscriptRequest | null>(null);
  const [contentRequest, setContentRequest] = useState<OpenAgentSessionTranscriptRequest | null>(
    null,
  );
  const contentFrameRef = useRef<number | null>(null);
  const open = request !== null;

  const cancelContentFrame = useCallback(() => {
    if (contentFrameRef.current === null) {
      return;
    }

    globalThis.cancelAnimationFrame(contentFrameRef.current);
    contentFrameRef.current = null;
  }, []);

  const openSessionTranscript = useCallback(
    (nextRequest: OpenAgentSessionTranscriptRequest) => {
      requestContextTransition(() => {
        cancelContentFrame();
        setContentRequest(null);
        setRequest(nextRequest);

        contentFrameRef.current = globalThis.requestAnimationFrame(() => {
          contentFrameRef.current = globalThis.requestAnimationFrame(() => {
            contentFrameRef.current = null;
            setContentRequest(nextRequest);
          });
        });
      });
    },
    [cancelContentFrame, requestContextTransition],
  );

  const closeSessionTranscript = useCallback(() => {
    requestContextTransition(() => {
      cancelContentFrame();
      setContentRequest(null);
      setRequest(null);
    });
  }, [cancelContentFrame, requestContextTransition]);

  useEffect(() => cancelContentFrame, [cancelContentFrame]);
  const previousRepoRef = useRef(workspaceRepoPath);
  useEffect(() => {
    if (previousRepoRef.current === workspaceRepoPath) return;
    previousRepoRef.current = workspaceRepoPath;
    requestContextTransition(
      () => {
        cancelContentFrame();
        setContentRequest(null);
        setRequest(null);
      },
      undefined,
      { force: true },
    );
  }, [cancelContentFrame, requestContextTransition, workspaceRepoPath]);

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
        preview={preview}
        workspaceRepoPath={workspaceRepoPath}
        target={contentRequest?.target ?? null}
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
