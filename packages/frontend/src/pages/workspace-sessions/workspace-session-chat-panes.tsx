import type { WorkspaceSession } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { Activity, memo, useMemo, useState } from "react";
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
  const retained = panes
    .filter((pane) => pane.record.id !== current.record.id && ids.has(pane.record.id))
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
        .toSorted((left, right) => left.record.id.localeCompare(right.record.id))
        .map((pane) => (
          <Activity
            key={pane.record.id}
            mode={pane.record.id === current.record.id ? "visible" : "hidden"}
          >
            <div className="h-full min-h-0 overflow-hidden">
              <WorkspaceSessionChatPane {...pane} />
            </div>
          </Activity>
        ))}
    </div>
  );
}

const WorkspaceSessionChatPane = memo(function WorkspaceSessionChatPane({
  workspace,
  record,
  onToolRefresh,
  onSelectFile,
  workingDirectory,
  branchKey,
}: ChatPane) {
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
      />
    </ChatFileLinkProvider>
  );
});
