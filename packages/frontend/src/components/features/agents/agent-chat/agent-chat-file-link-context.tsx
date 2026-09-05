import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import type { TaskExecutionSelectedFile } from "../task-execution-file-explorer-model";
import { resolveChatFileLink } from "./agent-chat-file-link";

export type ChatFileLinkOwner = {
  repoPath: string | null;
  taskId: string | null;
  ownerKey: string;
  onSelectFile(file: TaskExecutionSelectedFile): void;
};

export const ChatFileLinkContext = createContext<((href: string) => void) | null>(null);
export const useChatFileLinkAction = () => use(ChatFileLinkContext);

export function ChatFileLinkProvider({
  owner,
  children,
}: {
  owner: ChatFileLinkOwner;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { repoPath, taskId, ownerKey, onSelectFile } = owner;
  const generation = useRef(0);
  const identity = useMemo(() => ({ repoPath, taskId, ownerKey }), [repoPath, taskId, ownerKey]);
  const activeIdentity = useRef<typeof identity | null>(null);
  useLayoutEffect(() => {
    activeIdentity.current = identity;
    generation.current += 1;
    return () => {
      activeIdentity.current = null;
      generation.current += 1;
    };
  }, [identity]);
  const openFile = useCallback(
    (href: string) => {
      if (activeIdentity.current !== identity) return;
      const request = ++generation.current;
      void (async () => {
        try {
          if (!repoPath || !taskId) throw new Error("The Task's Build Worktree is unavailable.");
          const worktree = await queryClient.fetchQuery(
            taskWorktreeQueryOptions({ repoPath, taskId }),
          );
          if (request !== generation.current) return;
          const result = resolveChatFileLink(href, worktree?.workingDirectory ?? null);
          if (result.kind === "invalid") throw new Error(result.message);
          if (result.kind === "file") onSelectFile(result.file);
        } catch (error) {
          if (request === generation.current)
            toast.error(`Cannot open file: ${href}`, { description: errorMessage(error) });
        }
      })();
    },
    [identity, onSelectFile, queryClient, repoPath, taskId],
  );
  return <ChatFileLinkContext value={openFile}>{children}</ChatFileLinkContext>;
}
