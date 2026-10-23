import { createContext, use } from "react";

export type ChatArtifactLinkTarget = { taskId: string; code: string };

export type ChatArtifactLinkOwner = {
  repoPath: string;
  taskId: string;
  ownerKey: string;
  onOpenArtifact: (artifactId: string) => void;
};

export const ChatArtifactLinkContext = createContext<
  ((target: ChatArtifactLinkTarget) => Promise<void>) | null
>(null);
export const useChatArtifactLinkAction = () => use(ChatArtifactLinkContext);
