import type { WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import { useQuery } from "@tanstack/react-query";
import { useMobileWorkspaces } from "@/composition/workspace-selection";

export type ChatRecordRead =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "missing"; reason: string }
  | { status: "ready"; workspace: WorkspaceRecord; record: WorkspaceSession };

/** The active chat that a sheet acts on, read from the active chat list of its workspace. */
export const useChatRecord = (workspaceId: string, sessionId: string): ChatRecordRead => {
  const { workspaces } = useMobileWorkspaces();
  const chats = useQuery(workspaceSessionListQueryOptions(workspaceId));
  const workspace = workspaces.find((candidate) => candidate.workspaceId === workspaceId);
  if (!workspace) {
    return { status: "missing", reason: "The workspace of this chat is no longer open." };
  }
  if (chats.data === undefined) {
    if (chats.error) {
      return {
        status: "error",
        message: errorMessage(chats.error),
        retry: () => {
          void chats.refetch();
        },
      };
    }
    return { status: "loading" };
  }
  const record = chats.data.find((candidate) => candidate.id === sessionId);
  if (!record) {
    return { status: "missing", reason: "This chat is archived or removed." };
  }
  return { status: "ready", workspace, record };
};
