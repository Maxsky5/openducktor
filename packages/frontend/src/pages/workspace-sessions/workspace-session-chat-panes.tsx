import type { WorkspaceSession } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { Activity, memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatFileLinkProvider } from "@/components/features/agents/agent-chat/agent-chat-file-link-provider";
import type { ChatFileLinkOwner } from "@/components/features/agents/agent-chat/agent-chat-file-link-context";
import { MAX_CACHED_TRANSCRIPTS } from "@/components/features/agents/agent-chat/agent-chat-transcript-model-cache";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";
import { WorkspaceSessionChat } from "./workspace-session-chat";

type ChatPane = {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  workingDirectory: string | null;
  branchKey: string;
  onToolRefresh: () => void;
  onSelectFile: (file: TaskExecutionSelectedFile) => false | void;
};

/** Keeps visited chats ready while hidden chats stop their effects and subscriptions. */
export function WorkspaceSessionChatPanes({
  sessionIds,
  ...current
}: ChatPane & { sessionIds: readonly string[] }) {
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
}: ChatPane & { mode: "visible" | "hidden" }) {
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

function chatPaneKey(pane: ChatPane): string {
  return `${pane.workspace.workspaceId}:${pane.record.id}`;
}

const WorkspaceSessionChatPaneContent = memo(function WorkspaceSessionChatPaneContent({
  workspace,
  record,
  onToolRefresh,
  onSelectFile,
  workingDirectory,
  branchKey,
  isMounted,
  visitKey,
}: ChatPane & { isMounted: () => boolean; visitKey: number }) {
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
  if (settings.isPending)
    return (
      <p role="status" className="p-4">
        Loading chat settings…
      </p>
    );
  if (settings.isError)
    return (
      <div role="alert" className="p-4">
        <p className="text-destructive">{errorMessage(settings.error)}</p>
        <Button onClick={() => void settings.refetch()}>Retry settings</Button>
      </div>
    );
  return (
    <ChatFileLinkProvider owner={owner}>
      <WorkspaceSessionChat
        workspace={workspace}
        record={record}
        chatSettings={settings.data.chat}
        reusablePrompts={settings.data.reusablePrompts}
        onToolRefresh={onToolRefresh}
        isMounted={isMounted}
        visitKey={visitKey}
      />
    </ChatFileLinkProvider>
  );
});
