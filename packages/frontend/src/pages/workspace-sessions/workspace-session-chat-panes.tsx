import type { WorkspaceSession } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
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
import { MAX_CACHED_TRANSCRIPTS } from "@/components/features/agents/agent-chat/agent-chat-transcript-model-cache";
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

/** Keeps visited chats ready while hidden chats stop their effects and subscriptions. */
export function WorkspaceSessionChatPanes({
  sessionIds,
  ...current
}: ChatPane & { sessionIds: readonly string[] }): ReactElement {
  const [panes, setPanes] = useState<ChatPane[]>([]);
  const ids = new Set(sessionIds);
  const currentKey = chatPaneKey(current);
  const retained = panes
    .filter(
      (pane) =>
        chatPaneKey(pane) !== currentKey &&
        // Only the current workspace's records can tell us which chats were removed.
        (pane.workspace.workspaceId !== current.workspace.workspaceId || ids.has(pane.record.id)),
    )
    .slice(-(MAX_CACHED_TRANSCRIPTS - 1));
  const shown = [...retained, current];
  const last = panes.at(-1);
  if (
    shown.length !== panes.length ||
    !last ||
    last.workspace !== current.workspace ||
    last.record !== current.record ||
    last.workingDirectory !== current.workingDirectory ||
    last.branchKey !== current.branchKey ||
    last.onToolRefresh !== current.onToolRefresh ||
    last.onActionsReady !== current.onActionsReady ||
    last.onSelectFile !== current.onSelectFile
  ) {
    setPanes(shown);
  }
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {shown
        .toSorted((left, right) => chatPaneKey(left).localeCompare(chatPaneKey(right)))
        .map((pane) => (
          <WorkspaceSessionChatPane
            key={chatPaneKey(pane)}
            {...pane}
            mode={chatPaneKey(pane) === currentKey ? "visible" : "hidden"}
          />
        ))}
    </div>
  );
}

const WorkspaceSessionChatPane = memo(function WorkspaceSessionChatPane({
  mode,
  ...pane
}: ChatPane & { mode: "visible" | "hidden" }): ReactElement {
  const [visit, setVisit] = useState({ mode, key: 0 });
  if (visit.mode !== mode) {
    setVisit({ mode, key: visit.key + (mode === "visible" ? 1 : 0) });
  }
  const mounted = useRef(false);
  // Activity stops its effects when hidden. Keep pane lifetime outside that boundary.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isMounted = useCallback(() => mounted.current, []);
  return (
    <Activity mode={mode}>
      <div className="h-full min-h-0 overflow-hidden">
        <WorkspaceSessionChatPaneContent {...pane} isMounted={isMounted} visitKey={visit.key} />
      </div>
    </Activity>
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
}: ChatPane & { isMounted: () => boolean; visitKey: number }): ReactElement {
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
          onActionsReady={onActionsReady}
        />
      </div>
    </ChatFileLinkProvider>
  );
});

function chatPaneKey(pane: ChatPane): string {
  return `${pane.workspace.workspaceId}:${pane.record.id}`;
}
