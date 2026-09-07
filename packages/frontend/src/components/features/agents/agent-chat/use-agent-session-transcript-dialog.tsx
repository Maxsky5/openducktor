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
import { useTaskExecutionFilePreviewController } from "../file-preview/use-task-execution-file-preview-controller";
import { AgentSessionTranscriptDialog } from "./agent-session-transcript-dialog";
import {
  AgentSessionTranscriptDialogContext,
  type AgentSessionTranscriptDialogContextValue,
  type OpenAgentSessionTranscriptRequest,
} from "./agent-session-transcript-dialog-context";

const DEFAULT_TITLE = "Conversation";
const DEFAULT_DESCRIPTION = "Read-only conversation.";

/** Keep transcript changes behind the preview's draft and save checks. */
export function AgentSessionTranscriptDialogHost({ children }: PropsWithChildren): ReactElement {
  const preview = useTaskExecutionFilePreviewController();
  const { requestContextTransition } = preview;
  const activeWorkspace = useActiveWorkspace();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const [request, setRequest] = useState<OpenAgentSessionTranscriptRequest | null>(null);
  const [contentRequest, setContentRequest] = useState<OpenAgentSessionTranscriptRequest | null>(
    null,
  );
  const contentFrameRef = useRef<number | null>(null);
  const fileSaveHandlerRef = useRef<((repoPath: string, taskId: string) => void) | null>(null);
  const registerFileSaveHandler = useCallback<
    AgentSessionTranscriptDialogContextValue["registerFileSaveHandler"]
  >((handler) => {
    fileSaveHandlerRef.current = handler;
    return () => {
      if (fileSaveHandlerRef.current === handler) fileSaveHandlerRef.current = null;
    };
  }, []);
  const onFileSaved = useCallback((repoPath: string, taskId: string) => {
    fileSaveHandlerRef.current?.(repoPath, taskId);
  }, []);
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

  const reset = useCallback(() => {
    cancelContentFrame();
    setContentRequest(null);
    setRequest(null);
  }, [cancelContentFrame]);

  const closeSessionTranscript = useCallback(() => {
    requestContextTransition(reset);
  }, [reset, requestContextTransition]);

  useEffect(() => cancelContentFrame, [cancelContentFrame]);
  const previousRepoRef = useRef(workspaceRepoPath);
  useEffect(() => {
    if (previousRepoRef.current === workspaceRepoPath) return;
    previousRepoRef.current = workspaceRepoPath;
    requestContextTransition(reset, undefined, { force: true });
  }, [reset, requestContextTransition, workspaceRepoPath]);

  const contextValue = useMemo(
    () => ({
      openSessionTranscript,
      closeSessionTranscript,
      registerFileSaveHandler,
    }),
    [closeSessionTranscript, openSessionTranscript, registerFileSaveHandler],
  );

  return (
    <AgentSessionTranscriptDialogContext.Provider value={contextValue}>
      {children}
      <AgentSessionTranscriptDialog
        preview={preview}
        onFileSaved={onFileSaved}
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
