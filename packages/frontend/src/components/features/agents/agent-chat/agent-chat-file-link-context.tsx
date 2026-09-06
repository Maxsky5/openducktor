import { createContext, use } from "react";
import type { TaskExecutionSelectedFile } from "../task-execution-file-explorer-model";

export type ChatFileLinkOwner = {
  repoPath: string | null;
  taskId: string | null;
  ownerKey: string;
  onSelectFile(file: TaskExecutionSelectedFile, trigger: HTMLAnchorElement): void;
};

export const ChatFileLinkContext = createContext<
  ((href: string, trigger: HTMLAnchorElement) => void) | null
>(null);
export const useChatFileLinkAction = () => use(ChatFileLinkContext);
