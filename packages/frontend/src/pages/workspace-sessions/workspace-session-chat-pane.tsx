import type { WorkspaceSession } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  memo,
  type ReactElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatFileLinkOwner } from "@/components/features/agents/agent-chat/agent-chat-file-link-context";
import { ChatFileLinkProvider } from "@/components/features/agents/agent-chat/agent-chat-file-link-provider";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useWorkspaceChatSettings } from "@openducktor/frontend-core/queries/use-workspace-chat-settings";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { WorkspaceConflictChatActions } from "./use-workspace-conflict-chat-actions";
import { WorkspaceSessionChat } from "./workspace-session-chat";

type ChatPane = {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  workingDirectory: string | null;
  branchKey: string;
  onToolRefresh: () => void;
  onActionsReady?:
    | ((ownerKey: string, actions: WorkspaceConflictChatActions | null) => void)
    | undefined;
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
};

/** Keep admitted sends live while the hidden chat surface stops its effects. */
export const WorkspaceSessionChatPane = memo(function WorkspaceSessionChatPane({
  isActive,
  ...pane
}: ChatPane & { isActive: boolean }): ReactElement {
  const [visit, setVisit] = useState({ isActive, key: 0 });
  if (visit.isActive !== isActive) {
    setVisit({ isActive, key: visit.key + (isActive ? 1 : 0) });
  }
  const mounted = useRef(false);
  // Admitted sends can finish while the chat surface stops its effects.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isMounted = useCallback(() => mounted.current, []);
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <WorkspaceSessionChatPaneContent
        {...pane}
        isMounted={isMounted}
        visitKey={visit.key}
        isActive={isActive}
      />
    </div>
  );
});

const WorkspaceSessionChatPaneContent = memo(function WorkspaceSessionChatPaneContent({
  workspace,
  record,
  onToolRefresh,
  onSelectFile,
  workingDirectory,
  branchKey,
  isMounted,
  visitKey,
  onActionsReady,
  isActive,
}: ChatPane & { isMounted: () => boolean; visitKey: number; isActive: boolean }): ReactElement {
  const owner = useMemo<ChatFileLinkOwner>(
    () => ({
      kind: "workspace",
      repoPath: workspace.repoPath,
      workingDirectory,
      ownerKey: `${record.id}:${branchKey}`,
      onSelectFile,
    }),
    [branchKey, onSelectFile, record.id, workingDirectory, workspace.repoPath],
  );
  const settings = useQuery(settingsSnapshotQueryOptions());
  const { chatSettings, chatSettingsError, retryChatSettingsLoad } = useWorkspaceChatSettings({
    hasWorkspace: true,
  });
  const settingsError = chatSettingsError ?? settings.error;
  return (
    <ChatFileLinkProvider owner={owner}>
      <div className="flex h-full min-h-0 flex-col">
        {settings.isPending ? (
          <p role="status" className="p-4">
            Loading chat settings...
          </p>
        ) : null}
        {settingsError ? (
          <div role="alert" className="p-4">
            <p className="text-destructive">{errorMessage(settingsError)}</p>
            <Button onClick={retryChatSettingsLoad}>Retry settings</Button>
          </div>
        ) : null}
        <WorkspaceSessionChat
          workspace={workspace}
          record={record}
          chatSettings={chatSettings}
          reusablePrompts={settings.data?.reusablePrompts ?? []}
          onToolRefresh={onToolRefresh}
          isMounted={isMounted}
          visitKey={visitKey}
          isActive={isActive}
          onActionsReady={onActionsReady}
        />
      </div>
    </ChatFileLinkProvider>
  );
});
