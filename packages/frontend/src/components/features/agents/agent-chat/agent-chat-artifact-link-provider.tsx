import { taskArtifactsQueryOptions } from "@openducktor/frontend-core/queries/artifacts";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  ChatArtifactLinkContext,
  type ChatArtifactLinkOwner,
  type ChatArtifactLinkTarget,
} from "./agent-chat-artifact-link-context";

export function ChatArtifactLinkProvider({
  owner,
  children,
}: {
  owner: ChatArtifactLinkOwner | null;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const repoPath = owner?.repoPath ?? null;
  const taskId = owner?.taskId ?? null;
  const ownerKey = owner?.ownerKey ?? null;
  const onOpenArtifact = owner?.onOpenArtifact;
  const openAction = useRef(onOpenArtifact);
  useLayoutEffect(() => {
    openAction.current = onOpenArtifact;
  }, [onOpenArtifact]);
  const identity = useMemo(() => ({ repoPath, taskId, ownerKey }), [repoPath, taskId, ownerKey]);
  const activeIdentity = useRef<typeof identity | null>(null);
  const generation = useRef(0);
  useLayoutEffect(() => {
    activeIdentity.current = identity;
    generation.current += 1;
    return () => {
      activeIdentity.current = null;
      generation.current += 1;
    };
  }, [identity]);
  const openArtifact = useCallback(
    async (target: ChatArtifactLinkTarget): Promise<void> => {
      if (activeIdentity.current !== identity) return;
      if (!repoPath || !taskId || !openAction.current || target.taskId !== taskId) {
        throw new Error("This artifact belongs to another task. Open that task to view it.");
      }
      const request = ++generation.current;
      try {
        const collection = await queryClient.fetchQuery(
          taskArtifactsQueryOptions(queryClient, repoPath, taskId),
        );
        if (request !== generation.current) return;
        const artifact = collection.artifacts.find(
          (item) =>
            item.classification === "free" && item.taskId === taskId && item.code === target.code,
        );
        if (!artifact) {
          throw new Error(
            "This artifact is no longer available. Open the Artifacts panel to review it.",
          );
        }
        openAction.current?.(artifact.artifactId);
      } catch (error) {
        if (request === generation.current) throw error;
      }
    },
    [identity, queryClient, repoPath, taskId],
  );
  return (
    <ChatArtifactLinkContext value={owner ? openArtifact : null}>
      {children}
    </ChatArtifactLinkContext>
  );
}
