import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";
import { resolvedPathQueryOptions } from "@/state/queries/filesystem";
import { ChatFileLinkContext, type ChatFileLinkOwner } from "./agent-chat-file-link-context";
import { canonicalPathQueryOptions } from "@/state/queries/git";
import { parseChatFileLink, resolveChatFileLink } from "./agent-chat-file-link";

export function ChatFileLinkProvider({
  owner,
  children,
}: {
  owner: ChatFileLinkOwner;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { repoPath, ownerKey, onSelectFile } = owner;
  const taskId = owner.taskId ?? null;
  const workingDirectory = owner.workingDirectory ?? null;
  const isWorkspace = owner.kind === "workspace";
  const generation = useRef(0);
  const identity = useMemo(
    () => ({ repoPath, taskId, workingDirectory, ownerKey }),
    [repoPath, taskId, workingDirectory, ownerKey],
  );
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
    (href: string, trigger: HTMLAnchorElement) => {
      if (activeIdentity.current !== identity) return;
      const request = ++generation.current;
      void (async () => {
        try {
          const destination = parseChatFileLink(href);
          if (destination.kind === "invalid") throw new Error(destination.message);
          if (destination.kind !== "path") return;
          if (destination.absolute) {
            const path = await queryClient.fetchQuery(canonicalPathQueryOptions(destination.path));
            if (request !== generation.current) return;
            const rootPath = workingDirectory
              ? await queryClient.fetchQuery(resolvedPathQueryOptions(workingDirectory))
              : null;
            if (request !== generation.current) return;
            const result = resolveChatFileLink(
              { ...destination, path },
              rootPath,
              isWorkspace ? "workspace" : "task",
            );
            if (result.kind === "invalid") throw new Error(result.message);
            if (result.kind === "file") onSelectFile(result.file, trigger);
            return;
          }
          let root = workingDirectory;
          if (isWorkspace) {
            if (!repoPath || !root) throw new Error("The workspace directory is unavailable.");
          } else {
            if (!repoPath || !taskId) throw new Error("The Task's Build Worktree is unavailable.");
            const worktree = await queryClient.fetchQuery(
              taskWorktreeQueryOptions({ repoPath, taskId }),
            );
            if (request !== generation.current) return;
            if (!worktree) throw new Error("The Task's Build Worktree is unavailable.");
            root = worktree.workingDirectory;
          }
          const rootPath = await queryClient.fetchQuery(canonicalPathQueryOptions(root));
          if (request !== generation.current) return;
          let result = resolveChatFileLink(
            destination,
            rootPath,
            isWorkspace ? "workspace" : "task",
          );
          if (result.kind === "file" && result.file.access === "local") {
            // A symlink can change both the parent directory and file name.
            const path = await queryClient.fetchQuery(
              canonicalPathQueryOptions(`${rootPath}/${destination.path}`),
            );
            if (request !== generation.current) return;
            result = resolveChatFileLink(
              { ...destination, path, absolute: true },
              rootPath,
              isWorkspace ? "workspace" : "task",
            );
          }
          if (result.kind === "invalid") throw new Error(result.message);
          if (result.kind === "file") onSelectFile(result.file, trigger);
        } catch (error) {
          if (request === generation.current)
            toast.error(`Cannot open file: ${href}`, { description: errorMessage(error) });
        }
      })();
    },
    [identity, isWorkspace, onSelectFile, queryClient, repoPath, taskId, workingDirectory],
  );
  return <ChatFileLinkContext value={openFile}>{children}</ChatFileLinkContext>;
}
